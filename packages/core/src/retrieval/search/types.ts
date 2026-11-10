/**
 * Web-search provider contract (ADR-0013). One adapter per engine, chosen by
 * configuration; the pipeline only sees this interface.
 */
export interface WebSearchResult {
  title: string;
  url: string;
  /** Snippet or summary supplied by the engine, when available. */
  content?: string;
}

export type WebSearchProviderName = 'searxng' | 'brave' | 'serper';

export interface SearchProvider {
  readonly name: WebSearchProviderName;
  search(
    query: string,
    options?: { limit?: number },
  ): Promise<WebSearchResult[]>;
}
