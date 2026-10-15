import { z } from "zod";
import type { NewFragment } from "@/lib/fragments/local-store";

import {
  manualFragmentDraftSchema,
} from "@/lib/fragments/manual-draft";

export const chatGptDraftSchema = manualFragmentDraftSchema.extend({
  source: z.object({ channel: z.literal("chatgpt") }),
  // Preserve user-provided whitespace instead of transforming original input.
  original_input: z.string().min(1).refine((text) => text.trim().length > 0),
});

export const chatGptProposalRequestSchema = z.object({
  draft: chatGptDraftSchema,
}).strict();

export type ChatGptDraft = z.infer<typeof chatGptDraftSchema>;

/** Do not call the Web manual-draft adapter: it trims original_input. */
export function toChatGptFragmentInput(draft: ChatGptDraft): NewFragment {
  return { schema_version: "0.1", ...chatGptDraftSchema.parse(draft) };
}

export type ChatGptProposalStatus = "pending" | "committed";

export type ChatGptProposal = {
  _id: string;
  owner_id: string;
  status: ChatGptProposalStatus;
  draft: ChatGptDraft;
  created_at: Date;
  expires_at: Date;
  committed_at?: Date;
  fragment_id?: string;
};

export const PROPOSAL_TTL_MS = 30 * 60 * 1000;
