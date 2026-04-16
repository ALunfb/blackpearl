/**
 * Sliding-window rate limiter backed by timestamps.
 * Each limiter tracks events within a time window and enforces a max count.
 */
export class RateLimiter {
  constructor(windowMs, maxCount) {
    this.windowMs = windowMs;
    this.maxCount = maxCount;
    /** @type {Map<string, number[]>} key → sorted array of timestamps */
    this.buckets = new Map();
  }

  /**
   * Prune expired timestamps for a given key.
   */
  _prune(key) {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = this.buckets.get(key);
    if (!timestamps) return;
    // Remove entries older than the window
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }
    if (timestamps.length === 0) {
      this.buckets.delete(key);
    }
  }

  /**
   * Check if an event is allowed for the given key without consuming a slot.
   */
  canProceed(key = '_global') {
    this._prune(key);
    const timestamps = this.buckets.get(key);
    return !timestamps || timestamps.length < this.maxCount;
  }

  /**
   * Record an event for the given key. Returns true if allowed, false if rate-limited.
   */
  record(key = '_global') {
    this._prune(key);
    if (!this.canProceed(key)) return false;
    if (!this.buckets.has(key)) {
      this.buckets.set(key, []);
    }
    this.buckets.get(key).push(Date.now());
    return true;
  }

  /**
   * How many ms until the next slot opens for the given key.
   * Returns 0 if a slot is available now.
   */
  msUntilReady(key = '_global') {
    this._prune(key);
    const timestamps = this.buckets.get(key);
    if (!timestamps || timestamps.length < this.maxCount) return 0;
    return (timestamps[0] + this.windowMs) - Date.now();
  }
}
