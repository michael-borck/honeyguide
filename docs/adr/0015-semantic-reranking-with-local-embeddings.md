# 0015. Semantic re-ranking with local embeddings

**Status:** Accepted
**Date:** 2026-11-11

## Context

Multi-source retrieval (ADR-0013) returns roughly twenty candidates per topic.
The ranking step (`rank/diversity.ts`) balances formats and voices, but it does
not know whether a candidate is actually about the topic: a tangentially
related book can outrank a perfect paper simply because the format rotation
reaches it first.

A re-ranking pass is the standard fix. TypeSafe's Jev is a strong option — its
re-ranking cookbook raises top-1 accuracy from 5% to 30% on CLERC using one
Noul (probability) per query-candidate pair. But Jev is a hosted System One
model (`api.typesafe.ai`, priced per input token); it needs an API key and a
network call. That is a poor default for a desktop/personal app whose selling
point is local and private operation.

Local embedding models are smaller and simpler for this job. They need no key
and no per-token cost, and Ollama can serve them alongside the existing
rationale model. The user already has `nomic-embed-text` installed.

## Decision

1. **Optional semantic re-ranking.** A `EmbeddingProvider` interface embeds the
   topic and each candidate; the score is cosine similarity. Candidates are
   sorted by score *before* diversity balancing, so diversity remains a
   constraint (best item per format first) rather than the objective.
2. **Default provider is Ollama.** `EMBEDDING_URL` points at Ollama;
   `EMBEDDING_MODEL` defaults to `nomic-embed-text`. The provider uses the
   batch `/api/embed` endpoint and falls back to `/api/embeddings` for older
   Ollama. Embeddings are cached in-process, so repeated topics and resources
   are free.
3. **Explicit opt-in.** With no `EMBEDDING_URL` and no per-request embeddings
   setting, ranking is unchanged. The web/desktop Settings panel can supply an
   embeddings URL and model per request, so a personal user can enable it
   without environment variables.
4. **Non-fatal.** A missing model, timeout or bad response leaves the original
   retrieval order in place and reports `reranker` in `componentHealth`.
5. **Jev and ONNX are adapters, not defaults.** The interface is deliberately
   small. A TypeSafe Jev adapter (one Noul per candidate, high quality, hosted)
   or an ONNX runtime (no Ollama dependency) can be added later without
   touching the pipeline.

## Consequences

- On the five-topic golden set the relevance proxy rose from 72% to 78%, at a
  cost of roughly 1.5–2 seconds mean latency when enabled.
- Enabling requires pulling an embedding model (`ollama pull nomic-embed-text`,
  ~274 MB) and setting an endpoint; the desktop Settings panel exposes both.
- The embedding model is a quality lever: a better model should improve
  ranking without changing code.
- No API key, no per-token cost, no data leaves the machine in the default
  configuration.
- An ONNX path would remove the Ollama dependency but adds a runtime and model
  asset to the desktop bundle; deferred until the Ollama path proves
  insufficient.
