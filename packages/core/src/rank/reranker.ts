import type { Candidate } from '../retrieval/candidates.js';
import type { PipelineConfig } from '../config.js';
import { createEmbeddingProvider, type EmbeddingProvider } from './embeddings.js';
import { semanticScores } from './semantic.js';
import { OllamaDecisionReranker } from './decision.js';

/** A re-ranker scores retrieved candidates against the topic. */
export interface Reranker {
  readonly name: string;
  score(topic: string, candidates: Candidate[]): Promise<Map<Candidate, number>>;
}

/** Embedding-based re-ranking (ADR-0015). */
export class EmbeddingReranker implements Reranker {
  readonly name = 'embeddings';

  constructor(private readonly provider: EmbeddingProvider) {}

  score(topic: string, candidates: Candidate[]): Promise<Map<Candidate, number>> {
    return semanticScores(topic, candidates, this.provider);
  }
}

/**
 * Pick the best available local re-ranker (ADR-0015, ADR-0016). A System One
 * decision model is preferred when configured because it judges relevance
 * directly; embeddings are the fallback. With neither, ranking is unchanged.
 */
export function createReranker(config: PipelineConfig): Reranker | null {
  // An explicit Off beats a server-level re-ranker from the environment.
  if (config.rerankMode === 'off') return null;

  if (config.rerankMode === 'decision') {
    return config.decisionUrl
      ? new OllamaDecisionReranker(
          config.decisionUrl,
          config.decisionModel ?? 'tev1:0.8b',
          config.decisionApiKey,
        )
      : null;
  }

  if (config.rerankMode === 'embeddings') {
    if (!config.embeddingUrl) return null;
    const provider = createEmbeddingProvider(config);
    return provider ? new EmbeddingReranker(provider) : null;
  }

  // No explicit choice: decision first, then embeddings.
  if (config.decisionUrl) {
    return new OllamaDecisionReranker(
      config.decisionUrl,
      config.decisionModel ?? 'tev1:0.8b',
      config.decisionApiKey,
    );
  }
  if (config.embeddingUrl) {
    const provider = createEmbeddingProvider(config);
    return provider ? new EmbeddingReranker(provider) : null;
  }
  return null;
}
