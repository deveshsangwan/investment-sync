import {
  cleanupExpiredImportFiles,
  createApiContext,
  getAppEnv,
} from "@investment-sync/api";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const expectedSecret = getAppEnv().CRON_SECRET;
  const providedSecret = request.headers
    .get("authorization")
    ?.replace("Bearer ", "");

  if (expectedSecret && providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await cleanupExpiredImportFiles(
    createApiContext({
      auth: { userId: null },
    }),
  );

  return NextResponse.json(result);
}
