import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function expireSourceFile(
  ctx: MutationCtx,
  file: Doc<"sourceFiles">,
) {
  const object = file.storageId
    ? await ctx.db.system.get("_storage", file.storageId)
    : null;
  if (file.storageId && object) {
    try {
      await ctx.storage.delete(file.storageId);
    } catch {
      await ctx.db.patch("sourceFiles", file._id, {
        status: "delete_failed",
        expiresAt: Date.now() + 60 * 60 * 1000,
      });
      return;
    }
  }

  await ctx.db.patch("sourceFiles", file._id, { status: "deleted" });
  const batch = await ctx.db.get("importBatches", file.batchId);
  if (
    batch &&
    (batch.status === "awaiting_upload" || batch.status === "parsing")
  ) {
    await ctx.db.patch("importBatches", batch._id, {
      status: "failed",
      errorMessage: "Source file expired",
      leaseExpiresAt: undefined,
    });
  }
}
