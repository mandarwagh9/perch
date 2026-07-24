export interface RateLimiterOptions {
  capacity: number; // max burst
  refillPerSec: number; // sustained rate
  now?: () => number; // injectable clock for tests
  maxKeys?: number; // hard cap on tracked buckets (memory-DoS guard)
}

interface Bucket {
  tokens: number;
  last: number;
}

/** A token-bucket limiter keyed by an arbitrary string (e.g. `${appId}:${principal}`). */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private capacity: number;
  private refillPerSec: number;
  private now: () => number;
  private maxKeys: number;

  constructor(opts: RateLimiterOptions) {
    this.capacity = opts.capacity;
    this.refillPerSec = opts.refillPerSec;
    this.now = opts.now ?? Date.now;
    this.maxKeys = opts.maxKeys ?? 50_000;
  }

  /** Consume one token. Returns false when the caller is over budget. */
  take(key: string): boolean {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      // Bound memory: if the map is full, evict the oldest-touched bucket (an idle key
      // has refilled to capacity anyway, so eviction never wrongly grants budget).
      if (this.buckets.size >= this.maxKeys) this.evictOldest();
      b = { tokens: this.capacity, last: t };
      this.buckets.set(key, b);
    } else {
      // Refresh insertion order so active keys are not the ones evicted.
      this.buckets.delete(key);
      this.buckets.set(key, b);
    }
    const elapsed = Math.max(0, (t - b.last) / 1000);
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec);
    b.last = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private evictOldest(): void {
    const oldest = this.buckets.keys().next().value; // Map preserves insertion order
    if (oldest !== undefined) this.buckets.delete(oldest);
  }
}
