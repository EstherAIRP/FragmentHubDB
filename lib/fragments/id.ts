import { fragmentIdSchema } from "@/lib/fragment-schema";

const MAX_FRAGMENT_NUMBER = 999_999;

export function formatFragmentId(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > MAX_FRAGMENT_NUMBER) {
    throw new Error(`Fragment number must be an integer between 0 and ${MAX_FRAGMENT_NUMBER}.`);
  }

  return `F-${String(value).padStart(6, "0")}`;
}

export function parseFragmentId(id: string): number {
  fragmentIdSchema.parse(id);
  return Number(id.slice(2));
}

export function nextFragmentId(ids: Iterable<string>): string {
  let max = 0;

  for (const id of ids) {
    const parsed = fragmentIdSchema.safeParse(id);
    if (!parsed.success) continue;
    max = Math.max(max, parseFragmentId(parsed.data));
  }

  if (max >= MAX_FRAGMENT_NUMBER) {
    throw new Error("Fragment ID space is exhausted.");
  }

  return formatFragmentId(max + 1);
}
