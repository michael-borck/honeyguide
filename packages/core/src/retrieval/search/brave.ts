import { fetchJson } from '../candidates.js';
import type { SearchProvider, WebSearchResult } from './types.js';

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
}

/**
 * Brave Search API (ADR-0013): keyed fallback when SearXNG is unavailable or
 * blocked. Requires `BRAVE_API_KEY`.
 */
export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave' as const;

  constructor(private readonly apiKey: string) {}

  async search(query: string, options: { limit?: number } = {}): Promise<WebSearchResult[]> {
    const count = clamp(options.limit ?? 8, 1, 20);
    const url =
      'https://api.search.brave.com/res/v1/web/search?' +
      new URLSearchParams({
        q: query,
        count: String(count),
        safesearch: 'strict',
      }).toString();
    const data = (await fetchJson(url, {
      'x-subscription-token': this.apiKey,
    })) as { web?: { results?: BraveResult[] } };
    return (data.web?.results ?? [])
      .filter((r): r is BraveResult & { title: string; url: string } =>
        Boolean(r.title && r.url),
      )
      .slice(0, count)
      .map((r) => ({ title: r.title, url: r.url, content: r.description || undefined }));
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}
