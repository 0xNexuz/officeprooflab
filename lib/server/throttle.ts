/**
 * Best-effort, per-instance request throttle for Ant Ling calls (Ant Ling allows about two requests
 * per second per key; the daily token allowance is shared by every user of the deployment).
 */
export function createThrottle({ minGapMs, maxPerHour }: { minGapMs: number; maxPerHour: number }) {
  const recent = new Map<string, number[]>();
  return function throttled(key: string, now = Date.now()) {
    const windowStart = now - 60 * 60 * 1000;
    const times = (recent.get(key) ?? []).filter(time => time > windowStart);
    if ((times.length && now - times[times.length - 1] < minGapMs) || times.length >= maxPerHour) {
      recent.set(key, times);
      return true;
    }
    times.push(now);
    recent.set(key, times);
    return false;
  };
}
