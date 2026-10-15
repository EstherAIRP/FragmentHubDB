import { z } from "zod";

import {
  manualFragmentDraftSchema,
} from "@/lib/fragments/manual-draft";

export const chatGptDraftSchema = manualFragmentDraftSchema.extend({
  source: z.object({ channel: z.literal("chatgpt") }),
});

export const chatGptProposalRequestSchema = z.object({
  draft: chatGptDraftSchema,
}).strict();

export type ChatGptDraft = z.infer<typeof chatGptDraftSchema>;

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
