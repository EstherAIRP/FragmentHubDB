import { MongoClient, type Collection } from "mongodb";
import type { Fragment } from "@/lib/fragment-schema";

/** The Fragment's public id is its MongoDB _id. No ObjectId conversion. */
export type MongoFragmentDocument = Fragment & { _id: string };

let cachedClient: Promise<MongoClient> | undefined;

function mongoUri(): string {
  const uri = process.env.FragmentHubDB_MONGODB_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MongoDB is selected but FragmentHubDB_MONGODB_URI is missing.");
  }
  return uri;
}

export async function getMongoClient(): Promise<MongoClient> {
  if (!cachedClient) {
    const client = new MongoClient(mongoUri(), {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
    });
    cachedClient = client.connect().catch((error: unknown) => {
      cachedClient = undefined;
      throw error;
    });
  }
  return cachedClient;
}

export async function getMongoFragmentCollection(): Promise<Collection<MongoFragmentDocument>> {
  const client = await getMongoClient();
  return client
    .db(process.env.FragmentHubDB_MONGODB_DATABASE || "fragmenthubdb")
    .collection<MongoFragmentDocument>("fragments");
}

/** For CLI migration only. Server requests reuse the connection pool. */
export async function closeMongoClient(): Promise<void> {
  const pending = cachedClient;
  cachedClient = undefined;
  if (pending) await (await pending).close();
}
