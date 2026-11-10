# 0013. Multi-source paper retrieval and pluggable web search

**Status:** Accepted
**Date:** 2026-11-11

## Context

Paper discovery used one source: OpenAlex's topical search, with Crossref as a
fallback when OpenAlex fails (`retrieval/papers.ts`). That is a coverage and
resilience bottleneck — one query-shape mismatch, rate limit or outage narrows
the result set, and sources index different corners of the literature
(OpenAlex is broad, Semantic Scholar has citation graph data, Europe PMC is
strong in biomedicine, arXiv covers preprints).

Separately, web retrieval was hardwired to SearXNG
(`retrieval/web.ts`). SearXNG is the right free/self-host default, but upstream
engines rate-limit and block datacenter IPs, and a hosted deployment needs a
keyed fallback it can switch to without a code change.

The audit in `docs/audit.md` records both as high-severity findings (F2, F3).

## Decision

1. **Paper retrieval fans out.** `retrievePapers` queries OpenAlex topical,
   Semantic Scholar, Europe PMC and arXiv in parallel, each with
   `Promise.allSettled` so one failure never fails the request (ADR-0006).
   Results are deduplicated by normalised DOI and, when no DOI exists, by
   normalised title; duplicate records are merged to fill missing metadata
   (abstract, venue, licensing, DOI). Crossref via `cite-sight-core` remains
   the last-resort fallback when every source returns nothing.
2. **Web search is a provider interface.** `SearchProvider` exposes a single
   `search(query, options)` contract. Adapters for SearXNG, Brave and Serper
   are selected by configuration with the precedence
   `SEARXNG_URL` → `BRAVE_API_KEY` → `SERPER_API_KEY`. With none configured the
   web component reports unavailable, as before.
3. **New optional configuration.** `SEMANTIC_SCHOLAR_API_KEY` lifts the keyless
   rate limits on Semantic Scholar; `BRAVE_API_KEY` and `SERPER_API_KEY` enable
   the respective web providers. All are optional and absent by default.

Nothing about verification changes: every new paper source is a database and
therefore database-attested; web results remain URL-checked, never attested.

## Consequences

- Broader paper coverage and no single-source dependency. More outbound
  requests per suggestion; the paper sources are low-volume (one request each)
  and arXiv/Europe PMC are paced.
- Deduplication becomes important business logic, so it is a pure, tested
  function (`mergePaperCandidates`) rather than inline filtering.
- Self-hosters keep the keyless path (OpenAlex + Semantic Scholar keyless +
  Europe PMC + arXiv) and SearXNG; hosted can add keyed providers.
- New adapters are additive: a future Bing, DuckDuckGo or Crossref-based
  provider implements `SearchProvider` without touching the pipeline.
- The "LLM annotates, never retrieves" invariant is unchanged.
