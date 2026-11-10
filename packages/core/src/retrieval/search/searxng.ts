import { fetchJson } from '../candidates.js';
import type { SearchProvider, WebSearchResult } from './types.js';

interface SearxngResult {
  title?: string;
  url?: string;
  content?: string;
}

/**
 * Self-hosted metasearch (ADR-0013). Free and keyless, but it depends on
 * upstream engines that may rate-limit or block the instance — hence the
 * pluggable provider interface.
 */
export class SearxngSearchProvider implements SearchProvider {
  readonly name = 'searxng' as const;

  constructor(private readonly baseUrl: string) {}

  async search(query: string, options: { limit?: number } = {}): Promise<WebSearchResult[]> {
    const base = this.baseUrl.replace(/\/$/, '');
    const url =
      `${base}/search?` +
      new URLSearchParams({ q: query, format: 'json', safesearch: '1' }).toString();
    const data = (await fetchJson(url)) as { results?: SearxngResult[] };
    return (data.results ?? [])
      .filter((r): r is SearxngResult & { title: string; url: string } =>
        Boolean(r.title && r.url),
      )
      .slice(0, options.limit ?? 8)
      .map((r) => ({ title: r.title, url: r.url, content: r.content || undefined }));
  }
}
