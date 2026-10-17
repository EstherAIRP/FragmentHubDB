import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth";
import { getMongoClient } from "@/lib/mongodb/client";
import { diagnoseMongoDoctorError } from "@/lib/mongodb/doctor-diagnostics";

/**
 * Temporary, read-only Atlas probe restricted to the isolated Vercel Preview.
 * Do not expose raw MongoDB driver errors, URI, hosts, or credentials.
 * Does not list data or create collections and NEVER writes to the database.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers });
}

export async function GET() {
  // Fail closed in Production, locally, or on any non-test database.
  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.FragmentHubDB_DATA_STORE !== "mongodb" ||
    process.env.FragmentHubDB_MONGODB_DATABASE !== "fragmenthubdb_test"
  ) {
    return json({ status: "not_found" }, 404);
  }

  if (!(await isAuthenticated())) {
    return json({ status: "unauthorized" }, 401);
  }

  try {
    // ping is read-only and does not require creating or accessing collections.
    const client = await getMongoClient();
    await client.db("fragmenthubdb_test").command({ ping: 1 });
    return json({ status: "ok", check: "atlas_ping", database: "fragmenthubdb_test" });
  } catch (error) {
    const diagnosis = diagnoseMongoDoctorError(error);
    // Only safe, predefined diagnostics. NEVER serialize or log the raw error.
    return json(
      {
        status: "failed",
        check: "atlas_ping",
        code: diagnosis.code,
        guidance: diagnosis.guidance,
        ...(diagnosis.technicalCode
          ? { technicalCode: diagnosis.technicalCode }
          : {}),
      },
      503,
    );
  }
}
