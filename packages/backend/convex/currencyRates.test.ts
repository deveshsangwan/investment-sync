import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { currencyRatePolicy } from "./model/currencyRates";
import schema from "./schema";
import { modules } from "./test.setup";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("USD/INR refresh", () => {
  it("retries network and retryable provider failures once", async () => {
    const t = convexTest(schema, modules);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("network failure"))
      .mockResolvedValueOnce(Response.json({ rate: 83.25 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      t.action(internal.actions.refreshCurrencyRate.refreshCurrencyRate, {}),
    ).resolves.toEqual({ outcome: "saved", attempts: 2 });
    await expect(readRate(t)).resolves.toMatchObject({
      status: "fresh",
      rate: "83.25",
      refreshRevision: 1,
      quoteRevision: 1,
    });

    const retryable = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ rate: 84 }));
    vi.stubGlobal("fetch", retryable);
    await expect(
      t.action(internal.actions.refreshCurrencyRate.refreshCurrencyRate, {}),
    ).resolves.toEqual({ outcome: "saved", attempts: 2 });
  });

  it.each([
    {
      name: "a non-retryable provider response",
      response: () => new Response(null, { status: 400 }),
    },
    {
      name: "malformed JSON",
      response: () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
    {
      name: "a non-positive rate",
      response: () => Response.json({ rate: 0 }),
    },
  ])("does not retry $name", async ({ response }) => {
    const t = convexTest(schema, modules);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      t.action(internal.actions.refreshCurrencyRate.refreshCurrencyRate, {}),
    ).resolves.toEqual({ outcome: "failed", attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(readRate(t)).resolves.toMatchObject({
      status: "unavailable",
      refreshRevision: 1,
    });
  });

  it("times out and retries a stalled request", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      )
      .mockResolvedValueOnce(Response.json({ rate: 85 }));
    vi.stubGlobal("fetch", fetchMock);
    const refresh = t.action(
      internal.actions.refreshCurrencyRate.refreshCurrencyRate,
      {},
    );

    await vi.advanceTimersByTimeAsync(4100);
    await expect(refresh).resolves.toEqual({ outcome: "saved", attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fences late responses and old expiry jobs while retaining usable quotes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T01:00:00.000Z"));
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.currencyRates.beginRefresh, {});
    const second = await t.mutation(internal.currencyRates.beginRefresh, {});
    await expect(
      t.mutation(internal.currencyRates.saveQuote, {
        requestRevision: first.requestRevision,
        rate: "80",
        fetchedAt: "2025-01-01T00:00:00.000Z",
      }),
    ).resolves.toBe("superseded");
    await t.mutation(internal.currencyRates.saveQuote, {
      requestRevision: second.requestRevision,
      rate: "81",
      fetchedAt: "2025-01-01T01:00:00.000Z",
    });
    await expect(
      t.mutation(internal.currencyRates.markStale, {
        quoteRevision: first.requestRevision,
      }),
    ).resolves.toBe("superseded");
    await expect(readRate(t)).resolves.toMatchObject({
      status: "fresh",
      rate: "81",
    });

    const failed = await t.mutation(internal.currencyRates.beginRefresh, {});
    await t.mutation(internal.currencyRates.retainQuoteAfterFailure, {
      requestRevision: failed.requestRevision,
    });
    await expect(readRate(t)).resolves.toMatchObject({
      status: "fresh",
      rate: "81",
      refreshRevision: failed.requestRevision,
      quoteRevision: second.requestRevision,
    });
    vi.setSystemTime(new Date("2025-01-01T07:00:00.000Z"));
    await t.mutation(internal.currencyRates.markStale, {
      quoteRevision: second.requestRevision,
    });
    await expect(readRate(t)).resolves.toMatchObject({ status: "stale" });
    await expect(
      t.mutation(internal.currencyRates.markUnavailable, {
        quoteRevision: first.requestRevision,
      }),
    ).resolves.toBe("superseded");
    vi.setSystemTime(new Date("2025-01-08T01:00:00.000Z"));
    await t.mutation(internal.currencyRates.markUnavailable, {
      quoteRevision: second.requestRevision,
    });
    await expect(readRate(t)).resolves.toMatchObject({ status: "unavailable" });
  });

  it("materializes quote expiry after a failed refresh even before delayed timers run", async () => {
    vi.useFakeTimers();
    const fetchedAt = "2025-06-01T00:00:00.000Z";
    vi.setSystemTime(new Date(fetchedAt));
    const t = convexTest(schema, modules);
    const request = await t.mutation(internal.currencyRates.beginRefresh);
    await t.mutation(internal.currencyRates.saveQuote, {
      requestRevision: request.requestRevision,
      rate: "83.25",
      fetchedAt,
    });
    vi.setSystemTime(
      new Date(Date.parse(fetchedAt) + currencyRatePolicy.freshMilliseconds),
    );
    const failedFresh = await t.mutation(internal.currencyRates.beginRefresh);
    await t.mutation(internal.currencyRates.retainQuoteAfterFailure, {
      requestRevision: failedFresh.requestRevision,
    });
    expect(await readRate(t)).toMatchObject({
      status: "stale",
      rate: "83.25",
      quoteRevision: request.requestRevision,
    });

    vi.setSystemTime(
      new Date(Date.parse(fetchedAt) + currencyRatePolicy.usableMilliseconds),
    );
    const failedStale = await t.mutation(internal.currencyRates.beginRefresh);
    await t.mutation(internal.currencyRates.retainQuoteAfterFailure, {
      requestRevision: failedStale.requestRevision,
    });
    expect(await readRate(t)).toMatchObject({
      status: "unavailable",
      rate: "83.25",
      fetchedAt,
      quoteRevision: request.requestRevision,
    });
  });

  it("lets a delayed stale callback expire a seven-day-old quote while migration replacement stays frozen", async () => {
    vi.useFakeTimers();
    const fetchedAt = "2025-06-01T00:00:00.000Z";
    vi.setSystemTime(new Date(fetchedAt));
    const t = convexTest(schema, modules);
    const request = await t.mutation(internal.currencyRates.beginRefresh);
    await t.mutation(internal.currencyRates.saveQuote, {
      requestRevision: request.requestRevision,
      rate: "83.25",
      fetchedAt,
    });
    vi.stubEnv("MIGRATION_MODE", "synthetic");
    vi.setSystemTime(
      new Date(Date.parse(fetchedAt) + currencyRatePolicy.usableMilliseconds),
    );

    expect(
      await t.mutation(internal.currencyRates.markStale, {
        quoteRevision: request.requestRevision,
      }),
    ).toBe("unavailable");
    expect(await readRate(t)).toMatchObject({
      status: "unavailable",
      rate: "83.25",
      fetchedAt,
    });
    await expect(
      t.mutation(internal.currencyRates.saveQuote, {
        requestRevision: request.requestRevision,
        rate: "84",
        fetchedAt,
      }),
    ).resolves.toBe("superseded");
  });
});

function readRate(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const rates = await ctx.db.query("currencyRates").collect();
    if (rates.length !== 1) throw new Error("Expected one currency rate");

    return rates[0];
  });
}
