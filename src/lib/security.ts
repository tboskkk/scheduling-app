const rateLimits = new Map<string, { count: number; lastAttempt: number }>();

export const checkRateLimit = (key: string, limit: number, windowMs: number): boolean => {
  const now = Date.now();
  const record = rateLimits.get(key);

  if (!record) {
    rateLimits.set(key, { count: 1, lastAttempt: now });
    return true;
  }

  if (now - record.lastAttempt > windowMs) {
    rateLimits.set(key, { count: 1, lastAttempt: now });
    return true;
  }

  if (record.count >= limit) {
    return false;
  }

  record.count++;
  record.lastAttempt = now;
  return true;
};

export const resetRateLimits = () => {
  rateLimits.clear();
};
