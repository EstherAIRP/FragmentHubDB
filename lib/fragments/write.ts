import { fragmentSchema, type Fragment } from "@/lib/fragment-schema";
import {
  manualFragmentDraftSchema,
  type ManualFragmentDraft,
  type FragmentWriteInput,
} from "@/lib/fragments/manual-draft";

function editableFields(draft: ManualFragmentDraft) {
  const parsed = manualFragmentDraftSchema.parse(draft);

  return {
    scope: parsed.scope,
    type: parsed.type,
    status: parsed.status,
    priority: parsed.priority,
    urgency: parsed.urgency,
    domains: parsed.domains,
    tags: parsed.tags,
    project: parsed.project,
    related: parsed.related,
    title: parsed.title,
    summary: parsed.summary,
    next_action: parsed.next_action,
    notes: parsed.notes,
  };
}

export function prepareCreateInput(
  draft: ManualFragmentDraft,
): FragmentWriteInput {
  const parsed = manualFragmentDraftSchema.parse(draft);

  return {
    schema_version: "0.1",
    ...editableFields(parsed),
    original_input: parsed.original_input,
    interview: [],
    source: {
      channel: "web",
    },
    ai: {
      classification_confirmed: true,
      interview_used: false,
    },
  };
}

export function prepareReplacement(
  current: Fragment,
  draft: ManualFragmentDraft,
): Fragment {
  return fragmentSchema.parse({
    schema_version: current.schema_version,
    ...editableFields(draft),
    id: current.id,
    created_at: current.created_at,
    updated_at: current.updated_at,
    original_input: current.original_input,
    interview: current.interview,
    source: current.source,
    ai: current.ai,
  });
}
