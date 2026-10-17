/** Protect FragmentHubDB from accidentally writing to an unrelated database. */
export function fragmentHubDbDatabaseName(configured?: string): string {
  const name = configured === undefined ? "fragmenthubdb" : configured;
  if (!/^fragmenthubdb(?:[-_][a-z0-9][a-z0-9_-]*)?$/.test(name)) {
    throw new Error(
      "Refusing MongoDB access: database name must start with fragmenthubdb.",
    );
  }
  return name;
}
