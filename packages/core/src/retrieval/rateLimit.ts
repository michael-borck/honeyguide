const lastCall = new Map<string, number>();

/**
 * Minimal per-service pacer for the keyless academic APIs, which ask for
 * polite request spacing (arXiv in particular). The first call for a service
 * returns immediately.
 */
export async function throttle(service: string, minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const previous = lastCall.get(service) ?? 0;
  const wait = Math.max(0, previous + minIntervalMs - now);
  lastCall.set(service, Math.max(now, previous + minIntervalMs));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
