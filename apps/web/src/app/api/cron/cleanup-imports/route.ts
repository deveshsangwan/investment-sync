import {
  cleanupExpiredImportFiles,
  createApiContext,
  getAppEnv,
  importErrorHttpStatus,
  isImportError,
  logger,
  runImportEffect,
} from "@investment-sync/api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const expectedSecret = getAppEnv().CRON_SECRET;
  if (!expectedSecret) {
    logger.error("Import cleanup is disabled because CRON_SECRET is missing");
    return NextResponse.json(
      { error: "Cleanup is not configured" },
      { status: 503 },
    );
  }

  const providedSecret = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runImportEffect(
      cleanupExpiredImportFiles(
        createApiContext({
          auth: { userId: null },
        }),
      ),
    );
    return NextResponse.json(result);
  } catch (error) {
    if (isImportError(error)) {
      logger.error("Import cleanup failed", {
        tag: error._tag,
        cause: "cause" in error ? error.cause : undefined,
      });
      return NextResponse.json(
        { error: error.message },
        { status: importErrorHttpStatus(error) },
      );
    }
    logger.error("Unexpected import cleanup failure", { error });
    return NextResponse.json(
      { error: "Import cleanup failed" },
      { status: 500 },
    );
  }
}
