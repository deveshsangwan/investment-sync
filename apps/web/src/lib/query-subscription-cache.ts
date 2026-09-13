interface RetainedSubscription {
  consumers: number;
  unsubscribe: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

export function getQueryCacheRetentionMs(seconds: string | undefined) {
  const value = seconds?.trim() ? Number(seconds) : NaN;

  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483) {
    return 120_000;
  }

  return value * 1000;
}

/** Keeps Convex subscriptions alive; query results remain owned by Convex. */
export class QuerySubscriptionCache {
  private readonly entries = new Map<string, RetainedSubscription>();
  private readonly idle = new Map<string, RetainedSubscription>();

  constructor(
    private readonly retentionMs: number,
    private readonly maxIdleEntries: number,
  ) {}

  retain(key: string, subscribe: (onError: () => void) => () => void) {
    if (this.retentionMs === 0) return () => {};

    let entry = this.entries.get(key);
    if (!entry) {
      const subscription: RetainedSubscription = {
        consumers: 0,
        unsubscribe: () => {},
      };
      this.entries.set(key, subscription);
      subscription.unsubscribe = subscribe(() =>
        this.remove(key, subscription),
      );
      entry = subscription;
    }

    clearTimeout(entry.timer);
    entry.timer = undefined;
    this.idle.delete(key);
    entry.consumers += 1;
    let released = false;

    return () => {
      if (released || this.entries.get(key) !== entry) return;

      released = true;
      entry.consumers -= 1;
      if (entry.consumers > 0) return;

      this.idle.set(key, entry);
      entry.timer = setTimeout(() => this.remove(key, entry), this.retentionMs);

      if (this.idle.size > this.maxIdleEntries) {
        const oldest = this.idle.entries().next().value;
        if (oldest) this.remove(...oldest);
      }
    };
  }

  clear() {
    for (const [key, entry] of this.entries) this.remove(key, entry);
  }

  private remove(key: string, entry: RetainedSubscription) {
    if (this.entries.get(key) !== entry) return;

    clearTimeout(entry.timer);
    this.entries.delete(key);
    this.idle.delete(key);
    entry.unsubscribe();
  }
}
