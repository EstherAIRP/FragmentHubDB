import domainsConfig from "@/config/domains.json";
import { fragmentSchema, type Fragment } from "@/lib/fragment-schema";

export type FragmentValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type ValidateFragmentOptions = {
  previous?: Fragment | null;
};

const allowedDomains = new Set(Object.keys(domainsConfig.domains));

export function validateFragmentSemantics(
  candidate: unknown,
  fragments: readonly Fragment[],
  options: ValidateFragmentOptions = {},
): FragmentValidationIssue[] {
  const issues: FragmentValidationIssue[] = [];
  const parsed = fragmentSchema.safeParse(candidate);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        code: "schema",
        path: issue.path.length > 0 ? issue.path.join(".") : "$",
        message: issue.message,
      });
    }
    return issues;
  }

  const fragment = parsed.data;
  const byId = new Map(fragments.map((item) => [item.id, item]));

  for (const domain of fragment.domains) {
    if (!allowedDomains.has(domain)) {
      issues.push({
        code: "unknown_domain",
        path: "domains",
        message: `Unknown domain: ${domain}`,
      });
    }
  }

  if (fragment.project) {
    const parent = byId.get(fragment.project);

    if (!parent) {
      issues.push({
        code: "missing_project",
        path: "project",
        message: `Project ${fragment.project} does not exist.`,
      });
    } else if (parent.type !== "project") {
      issues.push({
        code: "invalid_project_type",
        path: "project",
        message: `Fragment ${fragment.project} exists but is not type=project.`,
      });
    }
  }

  for (const relatedId of fragment.related) {
    if (!byId.has(relatedId)) {
      issues.push({
        code: "missing_related",
        path: "related",
        message: `Related Fragment ${relatedId} does not exist.`,
      });
    }
  }

  if (options.previous) {
    if (options.previous.id !== fragment.id) {
      issues.push({
        code: "immutable_id",
        path: "id",
        message: "Fragment ID cannot be changed.",
      });
    }

    if (options.previous.created_at !== fragment.created_at) {
      issues.push({
        code: "immutable_created_at",
        path: "created_at",
        message: "created_at cannot be changed after creation.",
      });
    }
  }

  return issues;
}

export function assertFragmentSemantics(
  candidate: unknown,
  fragments: readonly Fragment[],
  options: ValidateFragmentOptions = {},
): Fragment {
  const parsed = fragmentSchema.parse(candidate);
  const issues = validateFragmentSemantics(parsed, fragments, options);

  if (issues.length > 0) {
    throw new FragmentDataValidationError(issues);
  }

  return parsed;
}

export class FragmentDataValidationError extends Error {
  readonly issues: FragmentValidationIssue[];

  constructor(issues: FragmentValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
    this.name = "FragmentDataValidationError";
    this.issues = issues;
  }
}
