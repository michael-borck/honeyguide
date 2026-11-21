import type { PipelineConfig } from '../../config.js';
import { clamp } from '../../util.js';
import { SearxngSearchProvider } from './searxng.js';
import { BraveSearchProvider } from './brave.js';
import { SerperSearchProvider } from './serper.js';
import type {
  SearchProvider,
  WebSearchProviderName,
  WebSearchResult,
} from './types.js';

export type { SearchProvider, WebSearchResult, WebSearchProviderName } from './types.js';
export { SearxngSearchProvider } from './searxng.js';
export { BraveSearchProvider } from './brave.js';
export { SerperSearchProvider } from './serper.js';

// Hosted instances keep the existing SearXNG-first default (ADR-0013). The
// desktop Settings panel sends "brave,serper,searxng" explicitly, so a user
// with a Brave key gets Brave first without changing the server default.
// Override either with SEARCH_FALLBACK_ORDER.
export const DEFAULT_SEARCH_FALLBACK_ORDER = 'searxng,brave,serper';

const PROVIDER_NAMES: WebSearchProviderName[] = ['brave', 'serper', 'searxng'];

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 100;
const searchCache = new Map<
  string,
  { at: number; results: WebSearchResult[] }
>();

export function __clearSearchCacheForTests(): void {
  searchCache.clear();
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function parseSearchOrder(value: string | undefined): WebSearchProviderName[] {
  const seen = new Set<string>();
  const names: WebSearchProviderName[] = [];
  for (const part of (value ?? DEFAULT_SEARCH_FALLBACK_ORDER).split(',')) {
    const name = part.trim().toLowerCase();
    if (!PROVIDER_NAMES.includes(name as WebSearchProviderName)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name as WebSearchProviderName);
  }
  return names.length ? names : [...PROVIDER_NAMES];
}

function normaliseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
    ]) {
      url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    let value = url.toString();
    if (value.endsWith('/')) value = value.slice(0, -1);
    return value;
  } catch {
    return raw;
  }
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Build the configured providers in order. A provider without its key or URL
 * is omitted. When fallback is disabled only the first configured provider is
 * kept.
 */
export function createSearchProviders(config: PipelineConfig): SearchProvider[] {
  const providers: SearchProvider[] = [];
  for (const name of parseSearchOrder(config.searchFallbackOrder)) {
    if (name === 'brave' && config.braveApiKey) {
      providers.push(new BraveSearchProvider(config.braveApiKey));
    } else if (name === 'serper' && config.serperApiKey) {
      providers.push(new SerperSearchProvider(config.serperApiKey));
    } else if (name === 'searxng' && config.searxngUrl) {
      providers.push(new SearxngSearchProvider(config.searxngUrl));
    }
  }
  return config.searchFallbackEnabled === false ? providers.slice(0, 1) : providers;
}

export async function runSearchFallback(
  providers: SearchProvider[],
  query: string,
  limit: number,
): Promise<WebSearchResult[]> {
  const seen = new Set<string>();
  const results: WebSearchResult[] = [];
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      // Over-fetch so filtering and de-duplication still leave enough.
      const raw = await provider.search(query, { limit: limit * 2 });
      for (const result of raw) {
        if (!isHttpUrl(result.url)) continue;
        const key = normaliseUrl(result.url);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ ...result, provider: provider.name });
        if (results.length >= limit) return results;
      }
    } catch (error) {
      errors.push(
        `${provider.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (results.length === 0 && errors.length > 0 && errors.length === providers.length) {
    throw new Error(`Web search failed: ${errors.join('; ')}`);
  }
  return results;
}

/**
 * A SearchProvider that tries the configured engines in order. Empty and
 * failed engines fall through; the first usable set stops the chain.
 */
export class FallbackSearchProvider implements SearchProvider {
  readonly name: WebSearchProviderName;

  constructor(
    private readonly providers: SearchProvider[],
    private readonly cacheKey?: string,
  ) {
    this.name = providers[0]?.name ?? 'searxng';
  }

  async search(
    query: string,
    options: { limit?: number } = {},
  ): Promise<WebSearchResult[]> {
    const limit = clamp(options.limit ?? 8, 1, 20);
    const key = this.cacheKey
      ? `${this.cacheKey}|${query.toLowerCase().trim().replace(/\s+/g, ' ')}|${limit}`
      : null;

    if (key) {
      const cached = searchCache.get(key);
      if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) {
        return cached.results;
      }
    }

    const results = await runSearchFallback(this.providers, query, limit);

    if (key && results.length > 0) {
      if (searchCache.size >= SEARCH_CACHE_MAX) {
        const oldest = searchCache.keys().next().value;
        if (oldest) searchCache.delete(oldest);
      }
      searchCache.set(key, { at: Date.now(), results });
    }
    return results;
  }
}

/**
 * Pick the configured web-search providers (ADR-0013). Returns null when none
 * is configured, which the pipeline reports as "unavailable".
 */
export function createSearchProvider(config: PipelineConfig): SearchProvider | null {
  const providers = createSearchProviders(config);
  if (!providers.length) return null;

  const cacheKey = [
    providers.map((provider) => provider.name).join(','),
    fingerprint(
      JSON.stringify({
        searxngUrl: config.searxngUrl ?? '',
        braveApiKey: config.braveApiKey ?? '',
        serperApiKey: config.serperApiKey ?? '',
        fallbackEnabled: config.searchFallbackEnabled !== false,
      }),
    ),
  ].join('|');

  return new FallbackSearchProvider(providers, cacheKey);
}
