export interface RateLimiterOptions {
  capacity: number; // max burst
  refillPerSec: number; // sustained rate
  now?: () => number; // injectable clock for tests
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

  constructor(opts: RateLimiterOptions) {
    this.capacity = opts.capacity;
    this.refillPerSec = opts.refillPerSec;
    this.now = opts.now ?? Date.now;
  }

  /** Consume one token. Returns false when the caller is over budget. */
  take(key: string): boolean {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, last: t };
      this.buckets.set(key, b);
    }
    const elapsed = Math.max(0, (t - b.last) / 1000);
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec);
    b.last = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
