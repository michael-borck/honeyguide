# Security Policy

## Supported versions

Only the latest release is supported with security updates.

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/michael-borck/honeyguide/security/advisories/new).
Do not open a public issue for security problems.

You can expect an acknowledgement within a week.

## Security posture worth knowing about

- **BYO API keys are never persisted server-side.** They live in the browser,
  are passed per request, and are held in memory only for the life of the
  call. In the web UI the key fields are kept in `sessionStorage` (cleared when
  the tab closes) rather than long-lived `localStorage`. If you find a code path
  that violates this, that is a vulnerability — please report it.
- **Server-side fetching of user-supplied URLs is SSRF-guarded.** Every fetch of
  a client-influenced URL (BYO provider/decision/embedding endpoints, web-search
  results, page-metadata lookups, link rechecks) resolves the hostname and
  rejects private/reserved addresses, and re-validates every redirect hop
  (`packages/core/src/net/ssrf.ts`). The hosted tier refuses private targets;
  only an explicitly trusted single-user host may set `HONEYGUIDE_ALLOW_PRIVATE=1`.
- **The hosted tier is hardened by default:** helmet (CSP, HSTS, `nosniff`,
  frame-deny), a per-IP rate limit on `/api`, capped request durations, and
  generic client-facing error messages (details are logged server-side only).
  Full screenshots are a self-host/desktop tier feature so the hosted tier never
  renders arbitrary pages in a browser.
- The hosted free tier enforces concurrency limits via a job queue to keep
  one user from monopolising the box.
- The Docker image runs as the unprivileged `node` user.
