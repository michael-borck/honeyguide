# Agent & contributor notes

## Toolchain — keep it current

- Target **Node 24 LTS** (see `.nvmrc`). The Docker image uses `node:24-alpine`
  and CI uses `actions/setup-node` with `node-version: 24`.
- Use **current GitHub Actions majors**: `actions/checkout@v5+`,
  `actions/setup-node@v5+`, current `docker/*` actions, and
  `softprops/action-gh-release@v3`.
- **Never emit `node-version: 20` or `node:20` base images.** Node 20 is EOL.
  Generated workflows should start on Node 24 and current action majors.
- Dependabot is **alerts-only**: do not add scheduled version-update PRs.
  Update dependencies deliberately and verify `npm audit --omit=dev` stays clean.

## Non-negotiables (from the ADRs)

- **Retrieval-grounded only** — never generate references. The LLM only
  annotates resources that retrieval already found.
- **Degradation is non-fatal** — a failed enrichment (verification, thumbnail,
  LLM) flags that field; it never fails the whole request.
- **Never persist user API keys server-side** — browser storage, passed per
  request; the web UI keeps them in `sessionStorage`.
- The core package has no UI or transport assumptions.

## Layout

- `packages/core` — retrieval, verification, ranking, rationale.
- Browser-safe shared logic for the web UI: import from
  `@michaelborck/honeyguide-core/web`; do not copy helpers into the web package.
- Web UI lives in `packages/web/src/{components,lib}`.

## Before submitting

- `npm run build` and `npm test` must pass (core + server suites).
