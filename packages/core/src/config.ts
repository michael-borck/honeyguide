/**
 * Pipeline configuration. Everything is optional: missing capability means
 * the corresponding component degrades non-fatally (ADR-0006) and reports
 * itself in componentHealth.
 */
export interface PipelineConfig {
  /** Ollama base URL for rationale generation (ADR-0003). */
  ollamaUrl?: string;
  /** Bearer key for Ollama behind an authenticating proxy. */
  ollamaApiKey?: string;
  /** Model name; generation tasks are sized for 4B–8B models (spec §8). */
  ollamaModel?: string;
  /** YouTube Data API v3 key; without it video retrieval is unavailable. */
  youtubeApiKey?: string;
  /**
   * Web search providers (ADR-0013). SearXNG is preferred when an instance
   * URL is set; otherwise a keyed provider is used. With none configured the
   * web component reports unavailable (ADR-0006).
   */
  searxngUrl?: string;
  braveApiKey?: string;
  serperApiKey?: string;
  /** Semantic Scholar API key; lifts keyless throttling on paper search. */
  semanticScholarApiKey?: string;
  /** Contact email passed to polite-pool APIs (Crossref/OpenAlex). */
  mailto?: string;
  /**
   * Full-page screenshot capture, ADR-0005 layer 3. Injected by the tier
   * that has a browser engine (desktop: Electron capturePage; self-host:
   * Playwright). Returns a data URL or undefined. Never set on the free
   * hosted tier — rendering arbitrary URLs server-side is an SSRF and
   * cost surface.
   */
  screenshot?: (url: string) => Promise<string | undefined>;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): PipelineConfig {
  return {
    ollamaUrl: env.OLLAMA_URL || undefined,
    ollamaApiKey: env.OLLAMA_API_KEY || undefined,
    ollamaModel: env.OLLAMA_MODEL || undefined,
    youtubeApiKey: env.YOUTUBE_API_KEY || undefined,
    searxngUrl: env.SEARXNG_URL || undefined,
    braveApiKey: env.BRAVE_API_KEY || undefined,
    serperApiKey: env.SERPER_API_KEY || undefined,
    semanticScholarApiKey: env.SEMANTIC_SCHOLAR_API_KEY || undefined,
    mailto: env.HONEYGUIDE_MAILTO || undefined,
  };
}
