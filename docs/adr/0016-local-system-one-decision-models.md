# 0016. Local System One decision models for re-ranking

**Status:** Accepted
**Date:** 2026-11-11

## Context

ADR-0015 added embedding-based re-ranking. It is cheap and local, but cosine
similarity only measures topical closeness; it cannot tell whether a paper
would actually be useful for teaching a topic.

Ollama 0.35+ ships `/v1/systemone`, a Jev-compatible System One endpoint.
Decision models such as `tev1:4b` (Together AI, 4B), `nimble` and `clef`
answer typed `choice`/`noul`/`score` questions and return calibrated
probabilities. They run locally, need no API key, and cost nothing per token.
In a local check with `tev1:4b`, a clearly relevant paper scored `0.994` and
an off-topic supply-chain paper scored `0.003` for the same topic.

The endpoint has limits: Tev1 runs with about a 2k-token context, the docs ask
for short inputs, and each question sees the full state. It is a reranker for
a shortlist, not a corpus search engine.

## Decision

1. **Add an `OllamaDecisionReranker`** (ADR-0016) that sends one
   `/v1/systemone` request per topic: `state = { topic, candidates }` and one
   `noul` question per candidate ("Is `candidates[i]` a resource a lecturer
   would plausibly use when teaching `topic`?"). The noul is the score.
2. **Bound the input**: at most 16 candidates, title/venue/description
   truncated, `keep_alive: 5m`. Unscored candidates keep their original
   order after the scored ones.
3. **Precedence**: a configured decision model is preferred over embeddings,
   which are preferred over the existing diversity-only ordering. All three
   paths are local and require no cloud account.
4. **Opt-in and non-fatal**: `DECISION_URL` / `DECISION_MODEL` (default
   `tev1:0.8b`), or the Settings panel's decision-model fields. A missing model
   or endpoint leaves the list in its retrieval order and reports `reranker`
   in `componentHealth`.
5. **TypeSafe Jev remains an optional future adapter.** The request shape is
   the same; a hosted adapter would only change the base URL and add an API
   key. It is not the default because it needs a network and a paid key.

## Consequences

- Ranking quality improves beyond embeddings while staying offline and free.
- The user must pull a decision model (`ollama pull tev1:0.8b`, ~1.5 GB, or
  `tev1:4b`, ~4.5 GB) and
  run Ollama 0.35+. The Settings panel detects decision models automatically
  via the `decision` capability.
- The 2k-token context caps the shortlist at 16; with more candidates the
  remainder is ordered by the previous ranking.
- First call after a cold start includes model load time; `keep_alive` keeps
  it warm for subsequent requests.
- The model can be wrong. It is a ranking signal, never a source of facts or
  citations.

## Addendum (measurement, 2026-11-11)

After making the decision-model shortlist round-robin across formats (papers
first otherwise consumed the whole budget), the five-topic golden set gave:

| Re-ranker | Relevance proxy | Mean latency |
|---|---|---|
| Diversity only | 72% | ~6.4s |
| Embeddings (`nomic-embed-text`) | 78% | ~8.2s |
| System One (`tev1:0.8b`) | **94–98%** | **~7–10s** |
| System One (`tev1:4b`) | 96% | ~26s |

The 0.8B decision model is the sweet spot: near-embedding latency with
decision-model quality. It is now the default decision model; `tev1:4b` trades
about 15 extra seconds for a point or two of accuracy. Re-ranking remains an
explicit setting (Off / Embeddings / Decision model), not a silent preference,
because even the 0.8B path costs a model download and a few seconds.
