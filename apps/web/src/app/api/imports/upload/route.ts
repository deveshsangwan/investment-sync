import {
  canManageHousehold,
  createApiContext,
  ensureMembership,
  importErrorHttpStatus,
  isImportError,
  logger,
  runImportEffect,
  uploadAndProcessImport,
  validateImportFile,
} from "@investment-sync/api";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const session = await auth();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  try {
    validateImportFile({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid import file" },
      { status: 400 },
    );
  }

  try {
    const claims = session.sessionClaims as
      | { email?: string; email_address?: string }
      | undefined;
    const ctx = createApiContext({
      auth: {
        userId: session.userId,
        email: claims?.email ?? claims?.email_address ?? null,
      },
    });
    const membership = await ensureMembership(ctx);
    if (!canManageHousehold(membership)) {
      return NextResponse.json(
        { error: "Only household owners can upload imports" },
        { status: 403 },
      );
    }

    const content = Buffer.from(await file.arrayBuffer());
    const result = await runImportEffect(
      uploadAndProcessImport(ctx, membership, {
        fileName: file.name,
        mimeType: file.type,
        content,
      }),
    );

    return NextResponse.json(result);
  } catch (error) {
    if (isImportError(error)) {
      logger.error("Import upload failed", {
        tag: error._tag,
        cause: "cause" in error ? error.cause : undefined,
      });
      return NextResponse.json(
        { error: error.message },
        { status: importErrorHttpStatus(error) },
      );
    }
    logger.error("Unexpected import upload failure", { error });
    return NextResponse.json(
      { error: "Import operation failed" },
      { status: 500 },
    );
  }
}
