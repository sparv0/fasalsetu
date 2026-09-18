// Fixed-window limiter held in process memory. Adequate for a single-instance deployment;
// a multi-instance deployment needs a shared store (e.g. Redis) instead.
export function createRateLimiter(limit: number, windowMs: number) {
  const windows = new Map<string, { start: number; count: number }>();
  return function check(key: string, now: number = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const w = windows.get(key);
    if (!w || now - w.start >= windowMs) {
      windows.set(key, { start: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (w.count >= limit) {
      return { allowed: false, retryAfterSeconds: Math.ceil((w.start + windowMs - now) / 1000) };
    }
    w.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  };
}
