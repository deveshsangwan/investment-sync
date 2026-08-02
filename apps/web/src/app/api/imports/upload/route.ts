import {
  canManageHousehold,
  createApiContext,
  ensureMembership,
  uploadAndProcessImport,
  validateImportFile,
} from "@investment-sync/api";
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

  try {
    validateImportFile({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
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
    if (!canManageHousehold(membership)) {
      return NextResponse.json(
        { error: "Only household owners can upload imports" },
        { status: 403 },
      );
    }

    const content = Buffer.from(await file.arrayBuffer());
    const result = await uploadAndProcessImport(ctx, membership, {
      fileName: file.name,
      mimeType: file.type,
      content,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 400 },
    );
  }
}
