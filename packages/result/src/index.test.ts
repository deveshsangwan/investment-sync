import { describe, expect, it } from "vitest";
import { tryCatch } from "./index";

describe("tryCatch", () => {
  it("returns fulfilled promises as successful results", async () => {
    const result = await tryCatch(Promise.resolve("done"));

    expect(result).toEqual({ ok: true, data: "done", error: null });
  });

  it("returns rejected promises as failed results", async () => {
    const error = new Error("async failure");
    const result = await tryCatch(Promise.reject(error));

    expect(result).toEqual({ ok: false, data: null, error });
  });
});
