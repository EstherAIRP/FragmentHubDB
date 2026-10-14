import { promises as fs } from "node:fs";
import path from "node:path";

import { buildFragmentIndex } from "../lib/fragments/index";
import { listLocalFragments } from "../lib/fragments/local-store";

const outputDirectory = path.join(process.cwd(), "generated");
const outputPath = path.join(outputDirectory, "index.json");

async function main() {
  const fragments = await listLocalFragments();
  const index = buildFragmentIndex(fragments);

  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `FragmentHub index generated: ${index.length} record(s) -> generated/index.json`,
  );
}

main().catch((error) => {
  console.error("FragmentHub index build failed:", error);
  process.exitCode = 1;
});
