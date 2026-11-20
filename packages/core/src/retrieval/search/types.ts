/**
 * Web-search provider contract (ADR-0013). One adapter per engine; the
 * fallback wrapper tries them in order and de-duplicates the merged set.
 */
export interface WebSearchResult {
  title: string;
  url: string;
  /** Snippet or summary supplied by the engine, when available. */
  content?: string;
  /** Provider that produced this result. */
  provider?: WebSearchProviderName;
}

export type WebSearchProviderName = 'searxng' | 'brave' | 'serper';

export interface SearchProvider {
  readonly name: WebSearchProviderName;
  search(
    query: string,
    options?: { limit?: number },
  ): Promise<WebSearchResult[]>;
}
