import { promises as fs } from "node:fs";
import path from "node:path";

import { fragmentSchema, type Fragment } from "@/lib/fragment-schema";
import { nextFragmentId } from "@/lib/fragments/id";
import {
  assertFragmentSemantics,
  FragmentDataValidationError,
} from "@/lib/fragments/semantic-validator";

export const fragmentDirectory = path.join(
  process.cwd(),
  "data",
  "fragments",
);

export type NewFragment = Omit<
  Fragment,
  "id" | "created_at" | "updated_at"
>;

export type ReplaceFragmentOptions = {
  expectedUpdatedAt?: string;
};

function filePathFor(id: string) {
  return path.join(fragmentDirectory, `${id}.json`);
}

export function serializeFragment(fragment: Fragment): string {
  return `${JSON.stringify(fragment, null, 2)}\n`;
}

export async function listLocalFragments(): Promise<Fragment[]> {
  let names: string[];

  try {
    names = await fs.readdir(fragmentDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files = names
    .filter((name) => /^F-\d{6}\.json$/.test(name))
    .sort();

  const fragments = await Promise.all(
    files.map(async (name) => {
      const raw = await fs.readFile(path.join(fragmentDirectory, name), "utf8");
      return fragmentSchema.parse(JSON.parse(raw));
    }),
  );

  return fragments.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getLocalFragment(id: string): Promise<Fragment | null> {
  try {
    const raw = await fs.readFile(filePathFor(id), "utf8");
    return fragmentSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function createLocalFragment(
  input: NewFragment,
): Promise<Fragment> {
  await fs.mkdir(fragmentDirectory, { recursive: true });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const current = await listLocalFragments();
    const id = nextFragmentId(current.map((fragment) => fragment.id));
    const now = new Date().toISOString();
    const candidate = fragmentSchema.parse({
      ...input,
      id,
      created_at: now,
      updated_at: now,
    });

    assertFragmentSemantics(candidate, current);

    try {
      await fs.writeFile(filePathFor(id), serializeFragment(candidate), {
        encoding: "utf8",
        flag: "wx",
      });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }

  throw new Error("Could not allocate a unique Fragment ID after 10 attempts.");
}

export async function replaceLocalFragment(
  id: string,
  replacement: Fragment,
  options: ReplaceFragmentOptions = {},
): Promise<Fragment> {
  const current = await getLocalFragment(id);

  if (!current) {
    throw new Error(`Fragment ${id} does not exist.`);
  }

  if (
    options.expectedUpdatedAt &&
    current.updated_at !== options.expectedUpdatedAt
  ) {
    throw new FragmentConflictError(
      `Fragment ${id} has changed since it was loaded.`,
    );
  }

  const all = await listLocalFragments();
  const next = fragmentSchema.parse({
    ...replacement,
    id: current.id,
    created_at: current.created_at,
    updated_at: new Date().toISOString(),
  });

  assertFragmentSemantics(
    next,
    all.filter((fragment) => fragment.id !== id),
    { previous: current },
  );

  if (current.type === "project" && next.type !== "project") {
    const projectChildren = all.filter(
      (fragment) =>
        fragment.id !== id && fragment.project === id,
    );

    if (projectChildren.length > 0) {
      throw new FragmentDataValidationError(
        projectChildren.map((fragment) => ({
          code: "project_has_children",
          path: fragment.id,
          message:
            `Fragment ${fragment.id} still uses ${id} as its project.`,
        })),
      );
    }
  }

  await fs.writeFile(filePathFor(id), serializeFragment(next), "utf8");
  return next;
}

export async function deleteLocalFragment(
  id: string,
  expectedUpdatedAt?: string,
): Promise<void> {
  const current = await getLocalFragment(id);

  if (!current) {
    throw new Error(`Fragment ${id} does not exist.`);
  }

  if (expectedUpdatedAt && current.updated_at !== expectedUpdatedAt) {
    throw new FragmentConflictError(
      `Fragment ${id} has changed since it was loaded.`,
    );
  }

  const all = await listLocalFragments();
  const inbound = all.filter(
    (fragment) =>
      fragment.id !== id &&
      (fragment.project === id || fragment.related.includes(id)),
  );

  if (inbound.length > 0) {
    throw new FragmentDataValidationError(
      inbound.map((fragment) => ({
        code: "inbound_reference",
        path: fragment.id,
        message: `Fragment ${fragment.id} still references ${id}.`,
      })),
    );
  }

  await fs.unlink(filePathFor(id));
}

export class FragmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FragmentConflictError";
  }
}
