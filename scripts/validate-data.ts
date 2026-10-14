import { promises as fs } from "node:fs";
import path from "node:path";

import { fragmentSchema, type Fragment } from "../lib/fragment-schema";
import { validateFragmentJsonSchema } from "../lib/fragments/json-schema-validator";
import { validateFragmentSemantics } from "../lib/fragments/semantic-validator";

const directory = path.join(process.cwd(), "data", "fragments");

type ReportIssue = {
  file: string;
  path: string;
  message: string;
};

async function main() {
  await fs.mkdir(directory, { recursive: true });
  const names = (await fs.readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort();

  const issues: ReportIssue[] = [];
  const fragments: Fragment[] = [];
  const ids = new Map<string, string>();

  for (const name of names) {
    const filePath = path.join(directory, name);
    let value: unknown;

    if (!/^F-\d{6}\.json$/.test(name)) {
      issues.push({
        file: name,
        path: "$",
        message: "Filename must use F-000001.json format.",
      });
    }

    try {
      value = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      issues.push({
        file: name,
        path: "$",
        message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    for (const issue of validateFragmentJsonSchema(value)) {
      issues.push({
        file: name,
        path: issue.path,
        message: `[${issue.keyword}] ${issue.message}`,
      });
    }

    const parsed = fragmentSchema.safeParse(value);

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          file: name,
          path: issue.path.length > 0 ? issue.path.join(".") : "$",
          message: issue.message,
        });
      }
      continue;
    }

    const fragment = parsed.data;
    const expectedName = `${fragment.id}.json`;

    if (name !== expectedName) {
      issues.push({
        file: name,
        path: "id",
        message: `Filename must match Fragment ID: expected ${expectedName}.`,
      });
    }

    const existingFile = ids.get(fragment.id);
    if (existingFile) {
      issues.push({
        file: name,
        path: "id",
        message: `Duplicate Fragment ID ${fragment.id}; also used by ${existingFile}.`,
      });
    } else {
      ids.set(fragment.id, name);
    }

    fragments.push(fragment);
  }

  for (const fragment of fragments) {
    for (const issue of validateFragmentSemantics(fragment, fragments)) {
      issues.push({
        file: `${fragment.id}.json`,
        path: issue.path,
        message: `[${issue.code}] ${issue.message}`,
      });
    }
  }

  if (issues.length > 0) {
    console.error(`FragmentHub data validation failed with ${issues.length} issue(s):\n`);

    for (const issue of issues) {
      console.error(`- ${issue.file} :: ${issue.path} :: ${issue.message}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log(`FragmentHub data validation passed: ${fragments.length} Fragment(s).`);
}

main().catch((error) => {
  console.error("FragmentHub data validation crashed:", error);
  process.exitCode = 1;
});
