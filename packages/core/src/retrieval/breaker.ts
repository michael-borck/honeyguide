interface FailureState {
  count: number;
  /** Epoch ms until which requests are skipped; 0 means still closed. */
  until: number;
}

/**
 * Per-host circuit breaker. After a few consecutive failures a host is
 * skipped for a cooldown, so one dead API does not add latency to every
 * request. The first success closes the circuit again.
 */
export class CircuitBreaker {
  private readonly failures = new Map<string, FailureState>();

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 60_000,
  ) {}

  canRequest(host: string, now = Date.now()): boolean {
    const state = this.failures.get(host);
    if (!state) return true;
    if (state.until > now) return false;
    // Only an expired *open* circuit resets the count; a closed circuit keeps
    // accumulating consecutive failures.
    if (state.until > 0) this.failures.delete(host);
    return true;
  }

  recordFailure(host: string, now = Date.now()): void {
    const state = this.failures.get(host);
    const count = (state?.count ?? 0) + 1;
    this.failures.set(host, {
      count,
      until: count >= this.threshold ? now + this.cooldownMs : 0,
    });
  }

  recordSuccess(host: string): void {
    this.failures.delete(host);
  }

  reset(): void {
    this.failures.clear();
  }
}

export const defaultBreaker = new CircuitBreaker();
