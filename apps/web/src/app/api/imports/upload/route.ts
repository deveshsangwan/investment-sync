import {
  createApiContext,
  ensureMembership,
  uploadAndProcessImport,
  validateImportFile,
} from "@investment-sync/api";
import { tryCatch } from "@investment-sync/result";
import { auth, currentUser } from "@clerk/nextjs/server";
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

  async function processUpload(importFile: File) {
    validateImportFile({
      fileName: importFile.name,
      mimeType: importFile.type,
      sizeBytes: importFile.size,
    });
    const user = await currentUser();
    const ctx = createApiContext({
      auth: {
        userId: session.userId,
        email:
          user?.primaryEmailAddress?.emailAddress ??
          (typeof session.sessionClaims?.email === "string"
            ? session.sessionClaims.email
            : null),
      },
    });
    const membership = await ensureMembership(ctx);
    const content = Buffer.from(await importFile.arrayBuffer());
    return uploadAndProcessImport(ctx, membership, {
      fileName: importFile.name,
      mimeType: importFile.type,
      content,
    });
  }

  const result = await tryCatch(processUpload(file));

  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          result.error instanceof Error
            ? result.error.message
            : "Import failed",
      },
      { status: 400 },
    );
  }

  return NextResponse.json(result.data);
}
