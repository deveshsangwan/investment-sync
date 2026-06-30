import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("getUsdInrRate", () => {
  it("returns a fresh rate when persistence fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ rate: 83.25 }), { status: 200 }),
        ),
    );
    const db = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi
            .fn()
            .mockRejectedValue(new Error("database unavailable")),
        }),
      }),
    };
    const { getUsdInrRate } = await import("./currency-rates");

    await expect(getUsdInrRate(db as never)).resolves.toMatchObject({
      rate: 83.25,
      isStale: false,
    });
  });
});
