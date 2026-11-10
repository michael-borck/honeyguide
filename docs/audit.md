# Application and design audit

**Date:** 2026-11-11
**Version audited:** 0.6.0
**Scope:** product design, retrieval pipeline, LLM use, implementation state,
hosting and self-host story.
**Method:** code reading across `packages/core`, `packages/server`,
`packages/web`, `packages/desktop` and `packages/cli`, plus the spec and ADRs;
comparison with `cite-sight` and `study-buddy`; live checks of the registry,
release assets and DNS.

---

## 1. What the app is

Honeyguide takes a teaching topic or document and returns a list of supporting
resources — papers, books, podcasts, videos and web pages — each verified to
exist and annotated with a short rationale, licensing status and
accessibility notes.

List mode is the shipped product. Interview mode is deliberately deferred
(ADR-0009) until list-mode usage shows where lecturers actually need
prompting.

## 2. Retrieval: real APIs, not generation

The single most important design property is that **the language model never
finds or names a resource**. Retrieval is plain HTTP against databases; the
LLM only writes prose about candidates that came back.

| Format | Source | Key | Attested |
|---|---|---|---|
| Papers | OpenAlex topical search (`title_and_abstract.search`, phrase-quoted), Crossref fallback via `cite-sight-core` | no | database |
| Books | Open Library Search API | no | database |
| Podcasts | iTunes Search API | no | database |
| Videos | YouTube Data API v3 | yes (BYO on hosted) | database |
| Web | SearXNG metasearch | no, but needs an instance | URL-checked |

The pipeline (`packages/core/src/pipeline.ts`) runs the configured sources,
deduplicates by URL, verifies, enriches, balances by format, then annotates.

### What Ollama is for

Ollama has three narrow, optional jobs, each with a deterministic fallback:

| Job | Code | Fallback |
|---|---|---|
| Turn a long pasted document (>150 chars) into a 3–8 word query | `retrieval/query.ts` | term-frequency phrase heuristic |
| Write a 1–2 sentence rationale about an already-retrieved resource | `annotate/ollama.ts` | extracted description → metadata only |
| Propose three critical queries for counterpoint mode | `retrieval/counterpoint.ts` | append "criticism / limitations evidence" |

Prompts say "do not invent details", run at low temperature, and are capped at
120 generated tokens. Every annotation carries provenance
(`llm | extracted | none`), so a generated rationale is never presented as
retrieved fact. A bad query can only return fewer results; it cannot create a
citation.

**Conclusion:** the common "local LLM will hallucinate sources" failure mode
does not apply to this architecture. The residual risk is a bland or
misleading *rationale*, which is labelled and degrades.

## 3. Verification and enrichment

- **Database results** are existence-attested by retrieval itself
  (`verify/verify.ts`): the DOI/entry came out of Crossref/OpenAlex/iTunes/Open
  Library seconds earlier, so no extra URL probe is made.
- **Web results** are not attested and get a full HTTP check via
  `cite-sight-core`'s `checkUrl` (SSRF-guarded; distinguishes live, redirect,
  blocked and dead). Dead links are dropped.
- Enrichment adds source type, the commercially-interested flag, licensing
  signals, accessibility notes, thumbnails (oEmbed/og:image, screenshots on
  desktop) and citation formats.
- Everything enrichment-related is non-fatal (ADR-0006) and reported in
  `componentHealth`.

Caveat: "verified" here means *database-attested*, not "the link is live and
free". A DOI can still resolve to a paywall or a moved publisher page. The UI
wording should distinguish those meanings (see F6).

## 4. State of the implementation (0.6.0)

### Shipped and working

List mode; topic and document input (PDF, DOCX, TXT, MD); verification;
source-type + commercial-interest labels; licensing; accessibility notes;
oEmbed/og:image thumbnails; annotation ladder; diversity ranking; counterpoint
mode; batch input; link-rot recheck (CLI); APA and Harvard citations; LMS-ready
HTML; Markdown; CLI; BullMQ queue; BYO-key settings; local Ollama detection;
PWA; Electron desktop (signed and notarised); multi-arch Docker image; npm
packages; GitHub release with installers.

Build and 22 unit tests pass. The release workflow's build, Docker and desktop
jobs are green.

### Present but narrower than documented

- **Screenshots** exist only on desktop, where Electron's Chromium is injected
  (`packages/desktop/src/main.ts`). The Docker server passes no capture engine,
  so the README/spec claim of Playwright screenshots for self-host is not true
  today.
- **Recheck** is CLI-only; the web UI has no recheck entry point.
- **Counterpoint** fans out to papers (and web when configured), not books,
  podcasts or videos.
- **Video and web** are off unless keys/an instance are configured. A default
  hosted deployment therefore returns three formats, not six.

### Not built

Semantic Scholar, arXiv, Europe PMC as discovery sources; podcast RSS; Wayback
fallback for dead links; canonical URL/date extraction; library permalinks;
learning-outcome/cognitive-level tags; interview mode; mobile.

## 5. Findings

| # | Finding | Severity |
|---|---|---|
| F1 | Hosted app is unreachable: `app.honeyguide.eduserver.au` has no DNS record, so the landing page's "Try it" button is dead. | High (ops) |
| F2 | Paper discovery rests on one source (OpenAlex, Crossref as fallback). Coverage and resilience are limited; a single API outage or query-shape mismatch narrows results. | High |
| F3 | Web search is hardwired to SearXNG. No keyed fallback exists when upstream engines rate-limit or block the instance, which is the most likely hosted failure. | High |
| F4 | Self-host screenshot capability is documented but absent; desktop README and product docs drift from the code. | Medium |
| F5 | Default deployment has no video or web results; the free tier quietly returns only papers, books and podcasts. | Medium |
| F6 | "Verified" conflates database attestation with link liveness; users may read it as "freely accessible". | Medium |
| F7 | Recheck and counterpoint are unevenly surfaced across CLI/web/desktop. | Low |
| F8 | Free-tier quota shape and usage logging remain open decisions. | Low |

## 6. Recommendations

1. **Fix the `app` DNS record** and put a TLS-terminating reverse proxy in front
   of the container. No landing-page change can substitute for this.
2. **Multi-source paper retrieval.** Fan out to OpenAlex, Semantic Scholar,
   Europe PMC and arXiv; deduplicate by DOI then normalised title; merge
   metadata; keep Crossref as the last-resort fallback. This directly addresses
   F2 and is the highest-value code change.
3. **Pluggable web search.** Introduce a `SearchProvider` interface with
   SearXNG, Brave and Serper adapters, selected by configuration. Keep SearXNG
   as the free/self-host default and a keyed provider as the hosted fallback
   (F3).
4. **Make screenshots honest** (F4): either inject a Playwright engine in the
   server image or correct the documentation to say "desktop only".
5. **Distinguish verification semantics** in the UI (F6): "record found" vs
   "link live" vs "access likely paywalled".
6. **Surface recheck/counterpoint consistently** or scope them explicitly as
   CLI features.
7. Keep the "LLM annotates, never retrieves" invariant as an explicit test and
   ADR-level constraint.

## 7. Self-host edition

The self-host edition is the same Docker image as the hosted app
(`ghcr.io/michael-borck/honeyguide:latest`): Express API plus the built React
UI in one container on port 3000. `docker-compose.yml` adds Redis for BullMQ
and an optional SearXNG profile; Ollama is external (host or compose service).

Differences from the hosted tier are configuration only:

- batch enabled by default (`HONEYGUIDE_ALLOW_BATCH=1`);
- no quota;
- your own Ollama and optional YouTube/SearXNG credentials;
- screenshots are desktop-only despite the docs (F4).

Desktop is the Electron shell embedding the same Express app on a loopback
port, plus Electron screenshots and auto-update.

## 8. Ideas worth borrowing

**From `cite-sight`:**
- Additional paper providers: Semantic Scholar, arXiv, Europe PMC, DataCite.
- Per-service rate limiting and lookup caching.
- `webSourceVerifier`, `crossReference`, duplicate handling, and the
  `explainVerification` confidence/"why this match" surface.
- SSRF guard and URL checker (Honeyguide already consumes the latter).

**From `study-buddy`:**
- A `SearchProvider` interface with SearXNG/Brave/Serper/Bing/DuckDuckGo
  adapters.
- `EXCLUDED_SITES` filtering (for example, exclude video hosts from *web*
  results).
- A settings surface with a "test search" action and zod-validated responses.

The first two suggestions are implemented in ADR-0013 and the accompanying
code change. The rest remain backlog.

## 8a. Follow-up status (2026-11-11)

Addressed since this audit was written:

- **F1** — `app.honeyguide.eduserver.au` now resolves and serves the app.
- **F2/F3** — multi-source paper retrieval and pluggable web search (ADR-0013).
- **F4** — documentation corrected: full screenshots are desktop-only; server
  Playwright remains unbuilt.
- **F6** — results now carry `verificationBasis` (`record found` vs
  `link live`) and `access` (`open` / `subscription` / `unknown`), refined
  with Unpaywall for DOI-bearing papers.
- **Ops** — `/api/health` reports retrieval sources; the Docker server and CLI
  now report the real package version instead of `0.0.0` / `0.1.1`.

Still open: F5 (video/web depend on configuration), F7 (recheck is CLI-only),
F8 (quota shape, usage logging), plus the enablers and bets in
[plan-bigger-bets.md](plan-bigger-bets.md).

## 9. Provenance

`github.com/michael-borck/honeyguide` was created 2026-07-26, is not a fork,
and began at "Initial project scaffold"; it was later renamed from Bowerbird.
GitHub has several unrelated repositories named `honeyguide` (HCV-Target data
tooling, FreeBSD `pot` flavours, a NIST project, a beakkeeping app, a
Google-Drive MCP server), but no teaching-resource discovery app. The project
and its concept are original to this repository.

## Appendix: key files

- Pipeline: `packages/core/src/pipeline.ts`
- Retrieval: `packages/core/src/retrieval/`
- Verification: `packages/core/src/verify/verify.ts`
- Annotation: `packages/core/src/annotate/`
- Config: `packages/core/src/config.ts`
- Server and queue: `packages/server/src/`
- Web UI: `packages/web/src/App.tsx`
- Desktop capture: `packages/desktop/src/main.ts`
- Deployment: `Dockerfile`, `docker-compose.yml`, `.github/workflows/`
- Hosting decision: `docs/adr/0008-hosting-vps-docker-plus-github-pages.md`
