import type { SearchProvider, WebSearchResult } from './types.js';

interface SerperResult {
  title?: string;
  link?: string;
  snippet?: string;
}

const ENDPOINT = 'https://google.serper.dev/search';
const TIMEOUT_MS = 8000;

/**
 * Serper (Google SERP) adapter (ADR-0013). Keyed fallback for hosted
 * deployments where a self-hosted SearXNG is an abuse surface. Requires
 * `SERPER_API_KEY`.
 */
export class SerperSearchProvider implements SearchProvider {
  readonly name = 'serper' as const;

  constructor(private readonly apiKey: string) {}

  async search(query: string, options: { limit?: number } = {}): Promise<WebSearchResult[]> {
    const num = clamp(options.limit ?? 8, 1, 10);
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({ q: query, num }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from serper.dev`);
    const data = (await res.json()) as { organic?: SerperResult[] };
    return (data.organic ?? [])
      .filter((r): r is SerperResult & { title: string; link: string } =>
        Boolean(r.title && r.link),
      )
      .slice(0, num)
      .map((r) => ({ title: r.title, url: r.link, content: r.snippet || undefined }));
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}
