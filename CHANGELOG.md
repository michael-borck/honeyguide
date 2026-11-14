# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.1] - 2026-11-14

### Changed

- Re-ranking settings are explicit: a **Server default** mode uses the
  instance's `.env`, **Off** now overrides a server-configured re-ranker, and
  **Use server defaults** in Settings clears browser-side provider, YouTube and
  model overrides.

## [0.7.0] - 2026-11-14

### Added

- Multi-source paper discovery (ADR-0013): OpenAlex, Semantic Scholar, Europe
  PMC and arXiv run in parallel and are merged, deduplicated by DOI then
  normalised title; Crossref remains the last-resort fallback. One source
  failing never fails the request.
- Pluggable web search (ADR-0013): `SearchProvider` interface with SearXNG,
  Brave (`BRAVE_API_KEY`) and Serper (`SERPER_API_KEY`) adapters, selected by
  configuration. Optional `SEMANTIC_SCHOLAR_API_KEY` lifts Semantic Scholar's
  keyless throttling.
- Portable collections (ADR-0014): a versioned JSON collection file
  (`kind: honeyguide-collection`) can be saved from the web/desktop UI, written
  with `suggest --collection`, reopened, and rechecked. `recheck` now accepts
  collections as well as legacy `suggest`/`batch` JSON, and the server exposes
  `POST /api/recheck`. No server storage, accounts or permissions.
- Web UI: result filters (format, source type, access) and sort (year/title),
  a verification/access legend, proper loading/empty states, keyboard focus
  styles and a responsive filter bar.
- Golden-set evaluation harness: `npm run eval` runs representative topics
  through the real pipeline and reports coverage, relevance, diversity,
  open-access share and latency (`scripts/eval.mjs`,
  `eval/golden-set.json`).
- Optional local System One re-ranking (ADR-0016): Ollama 0.35+ decision
  models score candidates through the Jev-compatible `/v1/systemone`
  endpoint, one Noul per candidate. `tev1:0.8b` is the default (94–98%
  relevance proxy, ~7–10s); `tev1:4b` is slower with slightly higher
  accuracy. Preferred over embeddings.
- Local/desktop installs now default re-ranking to **Auto**: a detected
  decision model is used automatically, embeddings are the fallback, and
  explicit Off/Embeddings/Decision modes are still available in Settings.
- Learning-outcome alignment (ADR-0017): paste unit outcomes (one per line)
  and a local System One decision model proposes an outcome per resource,
  with embeddings as fallback. Each proposal shows its confidence; you confirm
  the ones you want, and only confirmed tags appear in Markdown/LMS exports.
  Outcomes and confirmations travel in the collection file. CLI:
  `suggest --outcomes outcomes.txt --collection` and
  `batch --outcomes outcomes.txt`.
- Unit-outline parsing: paste a full outline; an "Outcomes" section is
  detected, and week/module/assessment headings, list markers and LO/CLO codes
  are ignored.
- Optional one-line "why this outcome" reason per alignment from the local
  LLM (capped, labelled generated, disabled with
  `HONEYGUIDE_ALIGNMENT_REASONS=0`).
- Hand-labelled alignment evaluation: `npm run eval:alignment` (25 resources;
  84% accuracy, 94% precision, 79% recall, 100% abstention with
  `tev1:0.8b`).
- Interview mode (ADR-0018): an optional four-question brief (stance, prior
  knowledge, timing, constraints) compiles to `counterpoint`, search
  constraints and a teaching-context string for rationales. The brief is
  editable, persisted in browser/collection, and available from the UI without
  an LLM. CLI flags: `--open-access`, `--no-video`, `--since`, `--context`.
  ADR-0009 (deferral) is superseded.
- Optional semantic re-ranking (ADR-0015): local Ollama embeddings
  (`nomic-embed-text`) reorder candidates by relevance before diversity
  balancing, with an in-process embedding cache. Used as the fallback when no
  decision model is configured. Enabled with `EMBEDDING_URL`/`DECISION_URL` or
  the Settings panel; non-fatal if unavailable. The relevance proxy on the
  starter golden set rose from 72% to 78% with embeddings.
- Retrieval JSON responses are cached in-process for 10 minutes, and a
  per-host circuit breaker skips an API after repeated failures.
- Application and design audit (`docs/audit.md`) and a sequenced plan for the
  larger bets (`docs/plan-bigger-bets.md`).
- Open-access truth: papers with a DOI and `HONEYGUIDE_MAILTO` are checked
  against Unpaywall and labelled open access vs subscription. Results also
  carry `verificationBasis` so "record found in a database" is distinct from
  "link live".
- `/api/health` reports the configured retrieval sources and the web-search
  provider.

### Changed

- UI polish: a shared design system (cards, buttons, badges, forms), a
  card-based results layout with clearer hierarchy, a responsive shell,
  consistent panels, and improved focus, empty and loading states.

### Added

- Dark mode: a light/dark/system theme toggle in the header, persisted and
  defaulting to the OS preference; the dark palette matches the landing page.
- Focus-trapped Settings and Interview dialogs: backdrop, Escape to close,
  Tab/Shift+Tab cycling, focus restore and body scroll lock.
- Per-stage progress: the pipeline emits `query → retrieve → verify → rank →
  annotate → align → done` events, streamed over `POST /api/suggest/stream`
  (SSE) and shown as a labelled progress bar. Streaming is automatic for the
  inline desktop/self-host path; `HONEYGUIDE_ALLOW_STREAM=1` enables it when
  Redis/queue is present. Non-streaming paths keep an indeterminate bar.

### Fixed

- CLI `--version` reported a hardcoded `0.1.1`; it now reads the package
  version.
- The Docker server reported version `0.0.0`; it now reads `package.json`.
- Documentation no longer claims server-side/self-host screenshots: full-page
  capture is desktop-only today.

## [0.6.0] - 2026-11-10

### Changed

- Project name is Honeyguide throughout: docs, UI, landing page, URLs, npm
  packages (`@michaelborck/honeyguide-*`), the container image
  (`ghcr.io/michael-borck/honeyguide`), the CLI command `honeyguide`, and
  environment variables (`HONEYGUIDE_MAILTO`, `HONEYGUIDE_ALLOW_BATCH`).

## [0.5.0] - 2026-07-29

### Added

- Counterpoint mode (ADR-0012): a second retrieval pass through inverted
  queries surfaces verified material that disagrees with or complicates
  the framing, stance-labelled and rendered in its own section across
  web UI, markdown, and CLI (`--counterpoint`).
- Batch input (spec §9 tier feature): `/api/batch` and `honeyguide batch
  topics.txt` — many topics per run, one markdown document out. On by
  default for self-host/desktop; the hosted instance disables it with
  HONEYGUIDE_ALLOW_BATCH=0.
- Link-rot re-run mode: `honeyguide recheck saved.json` re-verifies a
  previously saved list (DOIs against the databases, URLs re-probed) and
  reports status changes first.
- Full-page screenshot thumbnails on desktop (ADR-0005 layer 3) via
  Electron's own Chromium, as fallback when oEmbed/og:image yield nothing.

### Changed

- Queue job timeout raised to 6 minutes — counterpoint doubles LLM work
  and self-hosted inference on modest hardware is slow.

## [0.4.0] - 2026-07-27

### Added

- The desktop app is now functional: the Electron main process embeds the
  same Express app the hosted server runs (`createApp` from the server
  package) on a loopback-only random port — one JSON contract, two homes.
- Settings panel in the web UI (shared by desktop): AI provider URL, key
  and model, plus a YouTube API key for video search. Stored in browser
  storage only, sent per request, never persisted server-side (ADR-0004).
- Local Ollama detection (`/api/detect-ollama`) with model listing —
  the talk-buddy first-run pattern.
- Per-request YouTube key joins the BYO contract; any BYO credential
  routes around the queue so it never lands in Redis.

### Changed

- Server refactored into an embeddable `createApp` plus a thin hosted
  entry point (env config, BullMQ runner, listen).

## [0.3.0] - 2026-07-27

### Added

- Licensing status on results (spec §3 institutional plumbing): CC /
  open-access / library-subscription for papers via OpenAlex, ebook access
  for books via Open Library, Creative Commons flag for YouTube videos.
- Accessibility notes: captions flag on videos from the YouTube API.
- Venue (journal / publisher / channel) on results.
- Citation export: APA 7 and Harvard, from held metadata only — missing
  fields are omitted, never invented.
- LMS-ready HTML export: single self-contained fragment, inline styles
  only (LMS editors strip style blocks), with annotation provenance.
- SearXNG service in the compose stack behind a `websearch` profile, with
  the settings file that enables its JSON API (`deploy/searxng/`).
- PWA: web manifest, feather icon, and a network-first service worker
  that never caches API responses.

### Fixed

- Duplicate results from one retrieval source (URL-level dedupe across
  all sources).
- Internal workspace dependencies use `*` so npm never substitutes a
  published registry copy for the local workspace.

## [0.2.1] - 2026-07-27

### Added

- BullMQ queue on the server: suggest requests run through Redis-backed
  workers (SUGGEST_CONCURRENCY, default 2) so one long generation cannot
  block the box; inline fallback when Redis is down. BYO-key requests
  bypass the queue so user keys never touch Redis (ADR-0004).
- Document upload in the web UI via `/api/extract` (PDF, DOCX, TXT, MD).
- Query derivation for document input: LLM keyword extraction with a
  phrase-frequency heuristic fallback that filters course-material
  boilerplate.

### Changed

- Paper retrieval now uses OpenAlex phrase-quoted title/abstract search
  with reconstructed abstracts, replacing plain relevance search that
  surfaced mega-cited off-topic works; Crossref remains the fallback.
- Open Library book search uses the same phrase-quoted strategy.

## [0.2.0] - 2026-07-27

### Added

- Working v1 list-mode pipeline: retrieval (papers via OpenAlex/Crossref
  through cite-sight-core, podcasts via iTunes, books via Open Library;
  videos and general web behind optional YOUTUBE_API_KEY / SEARXNG_URL),
  verification, source-type labelling with commercially-interested flag,
  og:image thumbnails, diversity-balanced ranking, markdown export.
- Annotation ladder (ADR-0011): Ollama-generated relational rationale,
  degrading per-resource to extracted description, then metadata-only,
  with provenance surfaced in every UI.
- CLI: `honeyguide suggest <topic>` and `--file` document input (PDF, DOCX,
  TXT, MD via cite-sight-core extractors), markdown or `--json` output.
- Server: `/api/suggest` with per-request BYO provider override
  (ADR-0004: held in memory for the life of the call only).
- Web UI: search, result cards with verification/source badges and
  annotation provenance, component health footer, markdown download.

## [0.1.1] - 2026-07-27

### Added

- Initial project scaffold: monorepo structure, docs, ADRs, CI/release
  workflows, Docker packaging, landing page, Electron desktop shell
  (ADR-0010), signed and notarised release pipeline.
