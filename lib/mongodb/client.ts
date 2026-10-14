import { MongoClient, type Collection } from "mongodb";
import type { MongoFragmentDocument } from "@/lib/mongodb/document";
import { fragmentHubDbDatabaseName } from "@/lib/mongodb/database-name";

let cachedClient: Promise<MongoClient> | undefined;

function mongoUri(): string {
  const uri = process.env.FragmentHubDB_MONGODB_URI;
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
    .db(fragmentHubDbDatabaseName(process.env.FragmentHubDB_MONGODB_DATABASE))
    .collection<MongoFragmentDocument>("fragments");
}

/** For CLI migration only. Server requests reuse the connection pool. */
export async function closeMongoClient(): Promise<void> {
  const pending = cachedClient;
  cachedClient = undefined;
  if (pending) await (await pending).close();
}
