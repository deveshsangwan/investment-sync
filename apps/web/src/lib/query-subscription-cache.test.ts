import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QuerySubscriptionCache,
  getQueryCacheRetentionMs,
} from "./query-subscription-cache";

describe("query subscription retention", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps a live subscription through navigation and expires 120 seconds after the last consumer leaves", () => {
    const cache = new QuerySubscriptionCache(120_000, 20);
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const leaveOverview = cache.retain("overview", subscribe);

    leaveOverview();
    vi.advanceTimersByTime(119_999);
    expect(unsubscribe).not.toHaveBeenCalled();

    const leaveAgain = cache.retain("overview", subscribe);
    expect(subscribe).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120_000);
    expect(unsubscribe).not.toHaveBeenCalled();

    leaveAgain();
    vi.advanceTimersByTime(120_000);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    cache.retain("overview", subscribe);
    expect(subscribe).toHaveBeenCalledTimes(2);
    cache.clear();
  });

  it("waits for every consumer, and isolates different query arguments", () => {
    const cache = new QuerySubscriptionCache(120_000, 20);
    const stopA = vi.fn();
    const stopB = vi.fn();
    const leaveA = cache.retain("holding:a", () => stopA);
    const leaveSecondA = cache.retain("holding:a", () => stopA);
    cache.retain("holding:b", () => stopB);

    leaveA();
    vi.advanceTimersByTime(120_000);
    expect(stopA).not.toHaveBeenCalled();
    leaveSecondA();
    vi.advanceTimersByTime(120_000);
    expect(stopA).toHaveBeenCalledOnce();
    expect(stopB).not.toHaveBeenCalled();
    cache.clear();
  });

  it("clears active and idle subscriptions immediately at the session boundary, including their timers", () => {
    const cache = new QuerySubscriptionCache(120_000, 20);
    const oldStop = vi.fn();
    const idleStop = vi.fn();
    const oldLeave = cache.retain("overview", () => oldStop);
    cache.retain("holdings", () => idleStop)();

    cache.clear();
    expect(oldStop).toHaveBeenCalledOnce();
    expect(idleStop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);

    const newStop = vi.fn();
    cache.retain("overview", () => newStop);
    oldLeave();
    vi.advanceTimersByTime(120_000);
    expect(newStop).not.toHaveBeenCalled();
    cache.clear();
  });

  it("evicts the oldest idle subscription at capacity without interrupting active views", () => {
    const cache = new QuerySubscriptionCache(120_000, 1);
    const stopActive = vi.fn();
    const stopFirst = vi.fn();
    const stopSecond = vi.fn();
    cache.retain("active", () => stopActive);
    cache.retain("first idle", () => stopFirst)();
    cache.retain("second idle", () => stopSecond)();

    expect(stopFirst).toHaveBeenCalledOnce();
    expect(stopActive).not.toHaveBeenCalled();
    expect(stopSecond).not.toHaveBeenCalled();
    cache.clear();
  });

  it("drops failed subscriptions so retry can create a fresh subscription", () => {
    const cache = new QuerySubscriptionCache(120_000, 20);
    const stop = vi.fn();
    let fail = () => {};
    const leave = cache.retain("overview", (onError) => {
      fail = onError;
      return stop;
    });
    leave();
    fail();
    expect(stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const retry = vi.fn(() => vi.fn());
    cache.retain("overview", retry);
    expect(retry).toHaveBeenCalledOnce();
    cache.clear();
  });

  it("can disable retention without opening extra subscriptions", () => {
    const cache = new QuerySubscriptionCache(0, 20);
    const subscribe = vi.fn(() => vi.fn());
    cache.retain("overview", subscribe)();
    expect(subscribe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("query cache configuration", () => {
  it.each([undefined, "", " ", "invalid", "-1", "Infinity", "1.5", "2147484"])(
    "uses 120 seconds for missing or invalid configuration: %s",
    (value) => {
      expect(getQueryCacheRetentionMs(value)).toBe(120_000);
    },
  );

  it.each([
    ["0", 0],
    ["60", 60_000],
    ["120", 120_000],
    ["300", 300_000],
  ])(
    "accepts a configurable whole number of seconds: %s",
    (value, expected) => {
      expect(getQueryCacheRetentionMs(String(value))).toBe(expected);
    },
  );
});
