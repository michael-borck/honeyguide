/**
 * Honeyguide core: retrieval, verification, ranking and rationale.
 *
 * This package has no UI or transport assumptions (ADR-0001). Verification
 * extends @michaelborck/cite-sight-core rather than duplicating it
 * (ADR-0002). Every enrichment step degrades non-fatally (ADR-0006), and
 * annotation follows the ladder in ADR-0011.
 */

export type * from './types.js';
export { suggestResources } from './pipeline.js';
export { suggestBatch, toBatchMarkdown, type BatchEntry } from './batch.js';
export { recheckResources, toRecheckMarkdown, type RecheckEntry } from './recheck.js';
export { deriveCounterQueries, heuristicCounterQueries } from './retrieval/counterpoint.js';
export {
  COLLECTION_KIND,
  COLLECTION_SCHEMA_VERSION,
  toCollectionFile,
  parseCollectionFile,
  resourcesFromSaved,
  type CollectionFile,
} from './collection.js';
export { configFromEnv, type PipelineConfig } from './config.js';
export { toMarkdown } from './export/markdown.js';
export { toCitations, formatApa, formatHarvard } from './export/citations.js';
export { toLmsHtml } from './export/lmsHtml.js';
export { mapOpenAlexLicensing } from './retrieval/openalexTopical.js';
export { createSearchProvider } from './retrieval/search/index.js';
export type {
  SearchProvider,
  WebSearchResult,
  WebSearchProviderName,
} from './retrieval/search/index.js';
export { mergePaperCandidates, normalizeDoi, normalizeTitle } from './retrieval/paperMerge.js';
export { parseArxivFeed, arxivEntriesToCandidates, buildArxivQuery } from './retrieval/arxiv.js';
export { getCachedJson, setCachedJson, clearJsonCache } from './retrieval/cache.js';
export { CircuitBreaker, defaultBreaker } from './retrieval/breaker.js';
export { parseEuropePmcResults } from './retrieval/europePmc.js';
export { diversify } from './rank/diversity.js';
export {
  createEmbeddingProvider,
  OllamaEmbeddingProvider,
  CachedEmbeddingProvider,
  type EmbeddingProvider,
} from './rank/embeddings.js';
export {
  cosineSimilarity,
  candidateText,
  semanticScores,
  orderByScores,
} from './rank/semantic.js';
export {
  createReranker,
  EmbeddingReranker,
  type Reranker,
} from './rank/reranker.js';
export {
  parseOutcomes,
  createOutcomeAligner,
  buildAlignmentRequest,
  parseAlignmentResponse,
  OllamaOutcomeAligner,
  EmbeddingOutcomeAligner,
  MAX_ALIGN_RESOURCES,
  MAX_ALIGN_OUTCOMES,
  type OutcomeAligner,
} from './align/outcomes.js';
export {
  buildSystemOneRequest,
  parseSystemOneScores,
  balancedSubset,
  OllamaDecisionReranker,
  MAX_DECISION_CANDIDATES,
} from './rank/decision.js';
export { classifySource } from './enrich/sourceType.js';
export { parsePageMeta, fetchPageMeta, type PageMeta } from './enrich/page.js';
export {
  mapUrlStatus,
  verifyCandidate,
  verificationText,
  type VerificationOutcome,
} from './verify/verify.js';
export { mapUnpaywallResponse, lookupUnpaywall } from './enrich/unpaywall.js';
export { deriveQuery, heuristicKeywords, extractPhrases } from './retrieval/query.js';
export { reconstructAbstract } from './retrieval/openalexTopical.js';
export type { Candidate } from './retrieval/candidates.js';

// Document input (PDF, DOCX, TXT, MD) comes straight from cite-sight-core.
export { extract, extractPdf, extractDocx } from '@michaelborck/cite-sight-core';
