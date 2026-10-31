import { randomUUID } from "node:crypto";
import {
  assertSourceWritesAllowed,
  cleanupExpiredImportFiles,
  createApiContext,
  getAppEnv,
  publicImportError,
  logger,
  runImportEffect,
  SourceWritesPausedError,
} from "@investment-sync/api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = randomUUID();
  const expectedSecret = getAppEnv().CRON_SECRET;

  if (!expectedSecret) {
    logger.error("Import cleanup is disabled because CRON_SECRET is missing");
    return NextResponse.json(
      { error: "Cleanup is not configured" },
      { status: 503 },
    );
  }

  const authorization = request.headers.get("authorization");

  if (authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    assertSourceWritesAllowed();

    const result = await runImportEffect(
      cleanupExpiredImportFiles(
        createApiContext({
          auth: { userId: null },
        }),
      ),
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SourceWritesPausedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    const failure = publicImportError(error);
    logger.error("Import cleanup failed", {
      requestId,
      code: failure.code,
      error,
    });

    return NextResponse.json(
      { error: failure.message, code: failure.code, requestId },
      { status: failure.status, headers: { "x-request-id": requestId } },
    );
  }
}
