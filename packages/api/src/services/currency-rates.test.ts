import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

describe("getUsdInrRate", () => {
  it("uses a fresh persisted quote before calling the provider", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const db = persistedRateDatabase({
      rate: "82.50",
      fetchedAt: new Date("2026-07-19T10:00:00.000Z"),
    });
    const { getUsdInrRate } = await import("./currency-rates");

    await expect(getUsdInrRate(db as never)).resolves.toMatchObject({
      rate: 82.5,
      fetchedAt: "2026-07-19T10:00:00.000Z",
      isStale: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

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

  it("rejects persisted quotes older than seven days", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const db = persistedRateDatabase({
      rate: "81.00",
      fetchedAt: new Date("2026-07-12T11:59:59.000Z"),
    });
    const { getUsdInrRate } = await import("./currency-rates");

    const rejection = expect(getUsdInrRate(db as never)).rejects.toThrow(
      "USD/INR exchange rate is unavailable",
    );
    await vi.runAllTimersAsync();
    await rejection;
  });

  it("rejects with the tagged error itself, not an opaque FiberFailure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const db = persistedRateDatabase({
      rate: "81.00",
      fetchedAt: new Date("2026-07-12T11:59:59.000Z"),
    });
    const { getUsdInrRate, CurrencyRateUnavailableError } =
      await import("./currency-rates");

    // Bare Effect.runPromise rejects with a FiberFailure, which preserves
    // .message but fails both checks below -- making the exported error class
    // useless to callers. Asserting on the message alone would not catch that.
    const caught = getUsdInrRate(db as never).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    const error = await caught;

    expect(error).toBeInstanceOf(CurrencyRateUnavailableError);
    expect((error as { _tag?: string })._tag).toBe(
      "CurrencyRateUnavailableError",
    );
  });

  it("uses a persisted quote within seven days when the provider is down", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const db = persistedRateDatabase({
      rate: "82.25",
      fetchedAt: new Date("2026-07-13T12:00:00.000Z"),
    });
    const { getUsdInrRate } = await import("./currency-rates");

    const quote = expect(getUsdInrRate(db as never)).resolves.toMatchObject({
      rate: 82.25,
      isStale: true,
    });
    await vi.runAllTimersAsync();
    await quote;
  });

  it("does not retry an invalid provider payload", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ rate: -1 }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const { getUsdInrRate } = await import("./currency-rates");

    await expect(getUsdInrRate()).rejects.toThrow(
      "USD/INR exchange rate is unavailable",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent provider lookups", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetch = vi.fn().mockReturnValue(response);
    vi.stubGlobal("fetch", fetch);
    const { getUsdInrRate } = await import("./currency-rates");

    const first = getUsdInrRate();
    const second = getUsdInrRate();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    resolveResponse?.(
      new Response(JSON.stringify({ rate: 84.1 }), { status: 200 }),
    );

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ rate: 84.1, isStale: false }),
      expect.objectContaining({ rate: 84.1, isStale: false }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries one transient provider failure", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rate: 83.75 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);
    const { getUsdInrRate } = await import("./currency-rates");

    await expect(getUsdInrRate()).resolves.toMatchObject({
      rate: 83.75,
      isStale: false,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

function persistedRateDatabase(row: { rate: string; fetchedAt: Date }) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([row]),
        }),
      }),
    }),
  };
}
