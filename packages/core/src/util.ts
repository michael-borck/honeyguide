/** Clamp `n` into [min, max]; non-finite input collapses to `min`. */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

/**
 * Run `fn` over `items` with at most `limit` concurrent invocations, in
 * order. Shared by the pipeline and the alignment-reason filler so the
 * concurrency pattern lives in one place.
 */
export async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}