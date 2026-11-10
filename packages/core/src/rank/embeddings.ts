/**
 * Embedding providers for semantic re-ranking (ADR-0015). The interface is
 * deliberately small so an ONNX or other local runtime can be added without
 * touching the pipeline.
 */
export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

const EMBED_TIMEOUT_MS = 15_000;

/**
 * Ollama embeddings. Uses the batch `/api/embed` endpoint (current Ollama)
 * and falls back to the older single-text `/api/embeddings` endpoint.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const base = this.baseUrl.replace(/\/$/, '');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(`${base}/api/embed`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = (await res.json()) as { embeddings?: number[][] };
      if (Array.isArray(data.embeddings) && data.embeddings.length === texts.length) {
        return data.embeddings;
      }
    }

    // Older Ollama: one prompt at a time.
    const out: number[][] = [];
    for (const text of texts) {
      const single = await fetch(`${base}/api/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      });
      if (!single.ok) throw new Error(`Ollama embeddings HTTP ${single.status}`);
      const data = (await single.json()) as { embedding?: number[] };
      if (!data.embedding) throw new Error('Ollama returned no embedding');
      out.push(data.embedding);
    }
    return out;
  }
}

/**
 * Process-local cache so repeated topics and resources do not re-embed. The
 * cache is small and evicts the oldest entries; embeddings are deterministic
 * for a given model, so this is safe.
 */
export class CachedEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  private readonly cache = new Map<string, number[]>();

  constructor(
    private readonly inner: EmbeddingProvider,
    private readonly maxEntries = 500,
  ) {
    this.name = inner.name;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const missing = [...new Set(texts.filter((t) => !this.cache.has(t)))];
    if (missing.length) {
      const vectors = await this.inner.embed(missing);
      missing.forEach((text, i) => {
        if (vectors[i]) this.set(text, vectors[i]);
      });
    }
    const out = texts.map((text) => this.cache.get(text));
    if (out.some((v) => !v)) throw new Error('embedding cache miss after fill');
    return out as number[][];
  }

  private set(text: string, vector: number[]): void {
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(text, vector);
  }
}

/** Build the configured embedding provider, or null when re-ranking is off. */
export function createEmbeddingProvider(options: {
  embeddingUrl?: string;
  embeddingModel?: string;
  embeddingApiKey?: string;
}): EmbeddingProvider | null {
  if (!options.embeddingUrl) return null;
  return new CachedEmbeddingProvider(
    new OllamaEmbeddingProvider(
      options.embeddingUrl,
      options.embeddingModel ?? 'nomic-embed-text',
      options.embeddingApiKey,
    ),
  );
}
