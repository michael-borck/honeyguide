# Architecture Decision Records

This directory records the significant architectural decisions for Honeyguide,
in the lightweight [MADR](https://adr.github.io/madr/) style. Each ADR is
immutable once accepted; a change of mind gets a new ADR that supersedes the
old one.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-typescript-monorepo-no-python-sidecar.md) | TypeScript monorepo, no Python sidecar | Accepted |
| [0002](0002-extend-cite-sight-core-for-verification.md) | Extend cite-sight-core for verification | Accepted |
| [0003](0003-self-hosted-ollama-with-byok.md) | Self-hosted Ollama behind a bearer key, with BYOK | Accepted |
| [0004](0004-byok-keys-never-persisted-server-side.md) | BYOK keys are never persisted server-side | Accepted |
| [0005](0005-layered-thumbnails-cheapest-first.md) | Layered thumbnails, cheapest first | Accepted |
| [0006](0006-non-fatal-degradation.md) | Degradation is non-fatal | Accepted |
| [0007](0007-defer-desktop-shell-choice.md) | Defer the desktop shell choice (Electron vs Tauri) | Superseded by 0010 |
| [0008](0008-hosting-vps-docker-plus-github-pages.md) | Hosting: VPS Docker for the app, GitHub Pages for the landing page | Accepted |
| [0009](0009-list-mode-first-interview-mode-deferred.md) | List mode first; interview mode deferred to v2 | Accepted |
| [0010](0010-electron-desktop-shell.md) | Electron for the desktop shell | Accepted |
| [0011](0011-annotation-ladder.md) | Annotation ladder: LLM rationale degrades to extractive description | Accepted |
| [0012](0012-counterpoint-via-query-inversion.md) | Counterpoint mode via query inversion | Accepted |
| [0013](0013-multi-source-paper-retrieval-and-search-providers.md) | Multi-source paper retrieval and pluggable web search | Accepted |
| [0014](0014-portable-collections-shared-teams-deferred.md) | Portable collections now, shared team collections deferred | Accepted |
| [0015](0015-semantic-reranking-with-local-embeddings.md) | Semantic re-ranking with local embeddings; Jev/ONNX as adapters | Accepted |
| [0016](0016-local-system-one-decision-models.md) | Local System One decision models for re-ranking | Accepted |
| [0017](0017-learning-outcome-alignment.md) | Learning-outcome alignment: local judgments, human confirmation | Accepted |

## Adding an ADR

Copy the template below into `NNNN-short-title.md` (next number in sequence),
fill it in, and add a row to the index.

```markdown
# NNNN. Title

**Status:** Proposed | Accepted | Superseded by [NNNN](...)
**Date:** YYYY-MM-DD

## Context

What situation forces a decision?

## Decision

What we decided, stated as a decision.

## Consequences

What becomes easier, what becomes harder, what we accept as a trade-off.
```
