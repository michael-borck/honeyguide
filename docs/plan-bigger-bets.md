# Plan: the bigger bets

**Date:** 2026-11-11
**Status:** Proposal
**Companion to:** [the 0.6.0 audit](audit.md)

This is a design and sequencing plan, not a commitment. It covers the four
larger product bets and the enablers they depend on. Each bet is written so it
can be cut, reordered or deferred without blocking the others.

## Guiding constraints

These hold for every bet below:

1. **The model annotates, it never retrieves.** A language model may classify,
   propose or re-rank candidates that real databases returned. It may never
   name a source. ADR-0011 and the audit's §2 keep this invariant.
2. **Degradation is non-fatal** (ADR-0006). A missing model, embedding engine
   or API leaves the list usable and clearly labelled.
3. **BYO keys never touch server storage** (ADR-0004).
4. **Verification stays honest.** Distinguish "record found in a database"
   from "link live" from "open access" — the 0.6.1 changes make that explicit.
5. **No new datastore without an ADR.** Honeyguide is stateless today. Anything
   that persists user work (collections, alignments) needs an explicit
   decision about where and for how long.

## Enabler 0 — Evaluation harness (do first)

Without this, every ranking or prompt change is guesswork.

- **Golden set:** 15–20 topics across disciplines, each with a small set of
  resources a lecturer would accept and a few known bad matches.
- **Metrics:** precision@10, format diversity, open-access share, median
  latency, and a human "would I keep this?" rating.
- **Runner:** a CLI script (`npm run eval`) that calls the pipeline with
  fixtures and prints a diff against the last baseline. Network calls are
  cached to keep runs comparable.
- **Status:** scaffolded — `scripts/eval.mjs` and `eval/golden-set.json`
  (five starter topics). `npm run eval -- --json` emits a baseline; grow the
  set as bets land. Caching and a formal baseline file are still to do.
- **Acceptance:** a baseline number for every subsequent bet; regressions are
  visible in CI or a checked-in report.
- **Effort:** M.

## Enabler 1 — Retrieval performance and source breadth

- **Caching + circuit breakers** per provider (in-memory or Redis): repeated
  topics and failed sources cost nothing.
- **Education-specific sources:** ERIC, DOAJ, CORE, Open Textbook Library, OER
  Commons. Each implements the same `Candidate` contract and merge function
  from ADR-0013.
- **Server-side screenshots:** either implement a Playwright capture engine
  behind a config flag (accepting the SSRF/cost trade-off) or keep
  screenshots desktop-only and keep the docs honest.
- **Acceptance:** median paper retrieval under ~2s warm, no single provider
  able to push request latency past its timeout.
- **Effort:** M.

---

## Bet 1 — Learning-outcome alignment

**Problem.** A lecturer does not just need "good resources"; they need
resources that serve a specific outcome in a specific week. Alignment is the
highest-value teaching-specific signal and the hardest for a general tool to
copy.

**Hypothesis.** If Honeyguide can map a resource to the unit's outcomes with a
confidence score and a one-line justification, lecturers will keep more of the
list and spend less time re-reading it.

**Design.**

- User uploads or pastes a unit outline / outcome list once per unit.
- Outcomes are extracted into a small structured list (`UnitOutcome`).
- During suggestion, the model proposes an alignment for each resource:
  `{ outcomeId, confidence: high|medium|low, reason }`. It sees only the
  outcome text and the retrieved resource metadata.
- The UI shows the proposed outcome as a badge with the reason, and the user
  can accept or reject it. Rejections are stored per unit.
- Export includes outcome tags only where a human accepted them, so the LMS
  file never carries a machine guess as fact.

**Data model (needs a persistence ADR).**

```
Unit        id, owner, title, createdAt
UnitOutcome id, unitId, text, order
Resource    (existing, ephemeral)
Alignment   unitId, resourceUrlHash, outcomeId, confidence, reason,
            acceptedByHuman, createdAt
```

**Boundaries.** The alignment step is an annotation rung: if the model is
unavailable, resources still return without outcome tags. The model is never
asked to invent outcomes or resources.

**Milestones.**

1. Outcome extraction from pasted text (heuristic + LLM), with a preview.
2. Alignment proposal in the pipeline and UI, clearly labelled as proposed.
3. Accept/reject persistence and export of accepted tags.
4. Golden-set evaluation of alignment quality.

**Risks.** Over-tagging (everything maps to everything) — mitigate with a
confidence floor and a cap per outcome. Privacy of unit outlines — store only
what the user explicitly saves, and make deletion easy.

**Effort:** L.

---

## Bet 2 — Collections

### 2a. Portable collections (now, personal-first)

**Problem.** A generated list is disposable. A lecturer wants to keep it,
reopen it, email it to a colleague, and check it for link rot later.

**Decision (ADR-0014).** A collection is a **versioned JSON file**, not a
server-side object:

```
{ kind: "honeyguide-collection", schemaVersion: 1,
  topic, createdAt, result: { resources, componentHealth } }
```

- Save from the web/desktop UI; write from the CLI with `--collection`.
- Open it again in the UI; re-run link checking (`recheck`, `POST /api/recheck`).
- Share by email, chat or file transfer. No accounts, no sync.
- Export to Markdown, LMS HTML, APA/Harvard as today.

**Why this first.** It is offline, private, requires no auth or database, and
establishes the schema a future team backend can store. It directly serves the
desktop/personal vision.

**Milestones.**

1. Versioned collection format and validator (done).
2. CLI `suggest --collection` and `recheck` accepting collections (done).
3. Web/desktop save/open and recheck (done).
4. Notes/outcome tags inside the file, once Bet 1 exists.
5. RIS/BibTeX export.

**Risks.** Users expecting real-time collaboration — make the "snapshot, not
a living document" distinction explicit in the UI.

### 2b. Shared team collections (deferred)

Real shared lists need a centralised backend, accounts (magic link or SSO),
permissions, conflict handling, a database, and retention/deletion policy.
That is a separate product surface and is **on hold** until usage evidence
justifies it. If built, the server stores the same `CollectionFile` documents
from 2a.

**Effort:** XL (and would need its own ADR set).

---

## Bet 3 — Interview mode

**Problem.** List mode guesses the brief. Lecturers often have a specific
intent: reinforce or challenge, before or after class, for novices or
advanced students.

**Hypothesis.** A short, structured pre-retrieval interview produces a better
first list than a topic string, without becoming a chatbot.

**Design.**

- Maximum 3–4 questions, each with tappable options plus free text:
  1. Should this reinforce the reading or challenge it? (support / counterpoint)
  2. What do students already have? (nothing / a reading / a lecture / notes)
  3. When will they use it? (pre-class / in-class / post-class / assessment)
  4. Any constraint? (open access only / no video / recent only)
- The answers compile into a **retrieval brief**: query, stance, filters,
  result mix and annotation emphasis. Retrieval itself is unchanged.
- The brief is visible and editable; "skip interview" always returns to list
  mode.
- The interview is a small state machine, not a free-form conversation. It
  can run without an LLM; the LLM only helps phrase the questions and expand
  the query.

**Milestones.**

1. Brief schema and compiler (pure functions, testable without the UI).
2. Deterministic question flow in the web UI; no LLM required.
3. Feed stance/filters/result mix into the pipeline.
4. Evaluate against list mode on the golden set.

**Risks.** Adding friction. Keep it optional ("Interview me" next to the
input), one screen, and remember answers per unit. ADR-0009 already defers
this until list-mode evidence exists; the sequencing below respects that.

**Effort:** M–L.

---

## Bet 4 — Semantic re-ranking (retrieval-grounded)

**Problem.** Diversity ranking ignores whether a resource is actually about
the topic. Multi-source retrieval now returns ~20 candidates; the current rank
is format balance, not relevance.

**Hypothesis.** A local embedding model can re-rank the retrieved candidates
against the topic and the unit outcomes, improving precision@10 without
introducing generation.

**Design.**

- Embed the topic (and, if present, the accepted outcomes) and each candidate's
  title + abstract/description.
- Score = cosine similarity combined with existing signals (recency, open
  access, citation count where available).
- Keep format/voice diversity as a **constraint**, not the objective: pick the
  best-scoring item per format, then fill.
- Prefer a local System One decision model when available: Ollama 0.35+
  `/v1/systemone` with `tev1:4b`, `nimble` or `clef`. One Noul question per
  candidate, scored in one request (ADR-0016).
- Fall back to local embeddings: Ollama `/api/embed`, default
  `nomic-embed-text` (ADR-0015). An ONNX runtime is the adapter for a
  no-Ollama desktop later.
- If neither is configured, keep the current diversity ranking (ADR-0006).

**Status.** Implemented (ADR-0015, ADR-0016): `Reranker` + `EmbeddingProvider`
interfaces, a local System One reranker over `/v1/systemone`, Ollama batch
embeddings with an in-process cache, sort-before-diversity, Settings panel
fields with detection, and a non-fatal `reranker` health entry. On the
five-topic golden set the relevance proxy moved 72% → 78% with embeddings and
72% → 96% with the `tev1:4b` decision model, at ~8s vs ~26s mean latency. The
Settings panel therefore exposes an explicit re-ranking mode (Off / Embeddings
/ Decision model) instead of silently choosing the slowest. Reproduce with
`DECISION_URL=http://localhost:11434 npm run eval` (or `EMBEDDING_URL=...`).
TypeSafe Jev (hosted) and ONNX (no Ollama) remain adapters to add when needed.

**Milestones.**

1. Embedding adapter with a local default and an Ollama path. Done.
2. Pure re-rank function: scores in, ordered list out; unit-tested with
   fixtures. Done.
3. Wire into the pipeline behind a config flag. Done.
4. Golden-set A/B against diversity-only ranking. Done (starter set).
5. ONNX adapter, or a Jev adapter for opted-in high-quality re-ranking.

**Risks.** Model download size and CPU cost; mitigate with a small model
(≤50 MB) and caching embeddings per URL. Embedding drift across models;
version the model in the cache key.

**Effort:** M.

---

## Sequencing

| Phase | Work | Why now |
|---|---|---|
| Now | Portable collections (2a); evaluation harness; caching/circuit breakers; docs honesty | Personal-first, offline, and every later bet needs a baseline and stable latency |
| Next | Semantic re-ranking; education sources | Highest quality-per-effort, no persistence required |
| Then | Learning-outcome alignment | Highest teaching-specific value; extends the collection file |
| Later | Shared team collections (2b) | Needs server, accounts, database and an ADR set |
| Last | Interview mode | Needs list-mode usage evidence (ADR-0009) |

## Success metrics

- **Precision@10** and human "keep" rate on the golden set.
- **Time to a usable list** (first run to export).
- **Repeat use** and collections created per unit.
- **Share of results accepted** without edits.
- **Latency**: p50/p95 for a single-topic request.

## Open questions

1. Where does persistent data live for hosted, self-host and desktop, and what
   is the deletion/retention policy? (ADR required.)
2. Do outcome alignments belong to the unit or the collection?
3. Which embedding model is small enough for a first-run desktop download?
4. Does server-side screenshot capture justify its SSRF and cost surface, or
   should screenshots stay desktop-only?
