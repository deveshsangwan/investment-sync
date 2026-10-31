import { randomUUID } from "node:crypto";
import {
  assertSourceWritesAllowed,
  canManageHousehold,
  createApiContext,
  ensureMembership,
  ImportValidationError,
  logger,
  publicImportError,
  runImportEffect,
  uploadAndProcessImport,
} from "@investment-sync/api";
import { getImportFileValidationError } from "@investment-sync/importers/import-validation";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const requestId = randomUUID();
  const headers = { "x-request-id": requestId };

  try {
    const session = await auth();

    if (!session.userId) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHENTICATED", requestId },
        { status: 401, headers },
      );
    }

    assertSourceWritesAllowed();

    const formData = await request.formData().catch((cause: unknown) => {
      throw new ImportValidationError({
        message: "Invalid multipart form",
        cause,
      });
    });
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing file", code: "VALIDATION", requestId },
        { status: 400, headers },
      );
    }

    const validationError = getImportFileValidationError({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });

    if (validationError) {
      return NextResponse.json(
        { error: validationError, code: "VALIDATION", requestId },
        { status: 400, headers },
      );
    }

    assertSourceWritesAllowed();

    const email =
      session.sessionClaims?.email ?? session.sessionClaims?.email_address;
    const ctx = createApiContext({
      auth: {
        userId: session.userId,
        email: typeof email === "string" ? email : null,
      },
    });
    const membership = await ensureMembership(ctx);

    if (!canManageHousehold(membership)) {
      return NextResponse.json(
        {
          error: "Only household owners can upload imports",
          code: "FORBIDDEN",
          requestId,
        },
        { status: 403, headers },
      );
    }

    const content = Buffer.from(await file.arrayBuffer());
    const result = await runImportEffect(
      uploadAndProcessImport(ctx, membership, {
        fileName: file.name,
        mimeType: file.type,
        content,
        requestId,
      }),
    );

    return NextResponse.json(result, { headers });
  } catch (error) {
    const failure = publicImportError(error);
    logger.error("Import upload failed", {
      requestId,
      code: failure.code,
      error,
    });

    return NextResponse.json(
      { error: failure.message, code: failure.code, requestId },
      { status: failure.status, headers },
    );
  }
}
