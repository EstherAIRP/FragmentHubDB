import { randomBytes } from "node:crypto";

import { getMongoClient } from "@/lib/mongodb/client";
import { fragmentHubDbDatabaseName } from "@/lib/mongodb/database-name";
import {
  chatGptDraftSchema,
  toChatGptFragmentInput,
  PROPOSAL_TTL_MS,
  type ChatGptDraft,
  type ChatGptProposal,
} from "@/lib/chatgpt/proposal-schema";
import { listMongoFragments } from "@/lib/mongodb/fragment-store";
import { nextFragmentId } from "@/lib/fragments/id";
import { assertFragmentSemantics } from "@/lib/fragments/semantic-validator";
import { withMongoFragmentWrite } from "@/lib/mongodb/write-transaction";
import { insertMongoFragmentInTransaction } from "@/lib/mongodb/fragment-store";

export class ProposalNotReadyError extends Error {
  constructor(public readonly statusCode: 403 | 404 | 409 | 410, message: string) {
    super(message);
  }
}

async function proposalsCollection() {
  const client = await getMongoClient();
  return client.db(
    fragmentHubDbDatabaseName(process.env.FragmentHubDB_MONGODB_DATABASE),
  ).collection<ChatGptProposal>("chatgpt_proposals");
}

/**
 * Proposal writes are NOT canonical Fragment writes; no Fragment is inserted
 * until an allowlisted GitHub identity approves via the web UI.
 */
export async function createChatGptProposal(
  draftInput: ChatGptDraft,
  ownerId: string,
): Promise<ChatGptProposal> {
  const draft = chatGptDraftSchema.parse(draftInput);
  const current = await listMongoFragments();
  const now = new Date();
  const input = toChatGptFragmentInput(draft);
  // Preliminary relationship checks; the canonical write revalidates under
  // the transaction lock to handle changes occurring after preview.
  assertFragmentSemantics({
    ...input,
    id: nextFragmentId(current.map((item) => item.id)),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  }, current);

  const collection = await proposalsCollection();
  await collection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
  const proposal: ChatGptProposal = {
    _id: randomBytes(24).toString("hex"),
    owner_id: ownerId,
    status: "pending",
    draft,
    created_at: now,
    expires_at: new Date(now.getTime() + PROPOSAL_TTL_MS),
  };
  await collection.insertOne(proposal);
  return proposal;
}

export async function getChatGptProposal(
  id: string,
  ownerId: string,
): Promise<ChatGptProposal | null> {
  if (!/^[a-f0-9]{48}$/.test(id)) return null;
  const collection = await proposalsCollection();
  return collection.findOne({ _id: id, owner_id: ownerId });
}

/** Atomic, one-time final approval. Repeated approval cannot create a second Fragment. */
export async function approveChatGptProposal(
  id: string,
  ownerId: string,
): Promise<string> {
  if (!/^[a-f0-9]{48}$/.test(id)) {
    throw new ProposalNotReadyError(404, "Proposal not found.");
  }
  return withMongoFragmentWrite(async (fragments, session, epoch) => {
    const client = await getMongoClient();
    const proposals = client.db(
      fragmentHubDbDatabaseName(process.env.FragmentHubDB_MONGODB_DATABASE),
    ).collection<ChatGptProposal>("chatgpt_proposals");

    const proposal = await proposals.findOne(
      { _id: id, owner_id: ownerId },
      { session },
    );
    if (!proposal) throw new ProposalNotReadyError(404, "Proposal not found.");
    if (proposal.status !== "pending") {
      throw new ProposalNotReadyError(409, "Proposal has already been committed.");
    }
    if (proposal.expires_at.getTime() <= Date.now()) {
      throw new ProposalNotReadyError(410, "Proposal has expired.");
    }

    const created = await insertMongoFragmentInTransaction(
      toChatGptFragmentInput(proposal.draft),
      fragments,
      session,
      epoch,
    );
    const result = await proposals.updateOne(
      { _id: id, owner_id: ownerId, status: "pending" },
      {
        $set: {
          status: "committed",
          committed_at: new Date(),
          fragment_id: created.id,
        },
      },
      { session },
    );
    if (result.modifiedCount !== 1) {
      throw new ProposalNotReadyError(409, "Proposal was updated concurrently.");
    }
    return created.id;
  });
}
