import type { Candidate } from '../retrieval/candidates.js';
import type { EmbeddingProvider } from './embeddings.js';

const MAX_TEXT_CHARS = 1200;

/** Cosine similarity of two vectors; 0 when either is empty or mismatched. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** The text embedded for a candidate: enough to judge topical relevance. */
export function candidateText(candidate: Candidate): string {
  return [candidate.title, candidate.venue, candidate.description]
    .filter(Boolean)
    .join('. ')
    .slice(0, MAX_TEXT_CHARS);
}

/**
 * Score each candidate against the topic by embedding similarity. Returns a
 * map keyed by candidate object (identity), not by URL, because duplicate
 * URLs are already deduplicated upstream.
 */
export async function semanticScores(
  topic: string,
  candidates: Candidate[],
  provider: EmbeddingProvider,
): Promise<Map<Candidate, number>> {
  const scores = new Map<Candidate, number>();
  if (!candidates.length) return scores;

  const texts = [topic, ...candidates.map(candidateText)];
  const vectors = await provider.embed(texts);
  if (vectors.length !== texts.length) {
    throw new Error('embedding count did not match the request');
  }
  const [topicVector, ...candidateVectors] = vectors;
  candidates.forEach((candidate, i) => {
    scores.set(candidate, cosineSimilarity(topicVector, candidateVectors[i]));
  });
  return scores;
}

/** Highest score first; candidates without a score keep their relative order. */
export function orderByScores(
  candidates: Candidate[],
  scores: Map<Candidate, number>,
): Candidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, score: scores.get(candidate) }))
    .sort((a, b) => {
      const sa = a.score ?? Number.NEGATIVE_INFINITY;
      const sb = b.score ?? Number.NEGATIVE_INFINITY;
      if (sa !== sb) return sb - sa;
      return a.index - b.index;
    })
    .map((entry) => entry.candidate);
}
