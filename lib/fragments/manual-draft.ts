import { z } from "zod";

import domainsConfig from "@/config/domains.json";
import {
  fragmentIdSchema,
  fragmentStatusSchema,
  fragmentTypeSchema,
  interviewItemSchema,
  levelSchema,
  scopeSchema,
  slugSchema,
  tagSchema,
  type Fragment,
} from "@/lib/fragment-schema";

const domainIds = Object.keys(domainsConfig.domains);

const domainSchema = slugSchema.refine(
  (value) => domainIds.includes(value),
  "Unknown domain.",
);

export const manualFragmentDraftSchema = z.object({
  scope: scopeSchema,
  type: fragmentTypeSchema,
  status: fragmentStatusSchema,
  priority: levelSchema,
  urgency: levelSchema,
  domains: z.array(domainSchema).max(5),
  tags: z.array(tagSchema).max(12),
  project: fragmentIdSchema.nullable(),
  related: z.array(fragmentIdSchema),
  title: z.string().trim().min(1).max(120),
  summary: z.string().max(2000),
  next_action: z.string().max(2000).nullable(),
  original_input: z.string().trim().min(1),
  notes: z.string().nullable(),
  interview: z.array(interviewItemSchema),
  source: z.object({
    channel: z.enum(["chatgpt", "web"]),
  }),
  ai: z.object({
    classification_confirmed: z.literal(true),
    interview_used: z.boolean(),
  }),
});

export type ManualFragmentDraft = z.infer<typeof manualFragmentDraftSchema>;

export type FragmentWriteInput = Omit<
  Fragment,
  "id" | "created_at" | "updated_at"
>;

export function toFragmentWriteInput(
  draft: ManualFragmentDraft,
): FragmentWriteInput {
  return {
    schema_version: "0.1",
    ...manualFragmentDraftSchema.parse(draft),
  };
}
