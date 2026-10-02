export function isAllowedLoopbackHost(host, port) {
  if (typeof host !== 'string' || host.length === 0) return false;
  const allowed = new Set([
    '127.0.0.1:' + port,
    'localhost:' + port,
    '[::1]:' + port
  ]);
  return allowed.has(host.toLowerCase());
}

export function isAllowedOrigin(origin, port) {
  if (origin === undefined) return true;
  if (typeof origin !== 'string' || origin === 'null') return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && isAllowedLoopbackHost(parsed.host, port);
  } catch {
    return false;
  }
}

export function createRateLimiter({ limit = 1000, windowMs = 1000, clock = () => Date.now() } = {}) {
  let windowStart = clock();
  let count = 0;
  return {
    allow() {
      const now = clock();
      if (now - windowStart >= windowMs) {
        windowStart = now;
        count = 0;
      }
      count += 1;
      return count <= limit;
    },
    get count() {
      return count;
    }
  };
}
