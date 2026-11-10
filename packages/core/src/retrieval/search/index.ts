import type { PipelineConfig } from '../../config.js';
import { SearxngSearchProvider } from './searxng.js';
import { BraveSearchProvider } from './brave.js';
import { SerperSearchProvider } from './serper.js';
import type { SearchProvider } from './types.js';

export type { SearchProvider, WebSearchResult, WebSearchProviderName } from './types.js';
export { SearxngSearchProvider } from './searxng.js';
export { BraveSearchProvider } from './brave.js';
export { SerperSearchProvider } from './serper.js';

/**
 * Pick the configured web-search provider (ADR-0013). A self-hosted SearXNG
 * instance is preferred because it is free and keyless; keyed providers are
 * the fallback for rules or environments that block metasearch. Returns null
 * when none is configured, which the pipeline reports as "unavailable".
 */
export function createSearchProvider(config: PipelineConfig): SearchProvider | null {
  if (config.searxngUrl) return new SearxngSearchProvider(config.searxngUrl);
  if (config.braveApiKey) return new BraveSearchProvider(config.braveApiKey);
  if (config.serperApiKey) return new SerperSearchProvider(config.serperApiKey);
  return null;
}
