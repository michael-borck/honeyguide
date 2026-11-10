# 0014. Portable collections now, shared team collections deferred

**Status:** Accepted
**Date:** 2026-11-11

## Context

The desktop/personal workflow is the current focus: a lecturer runs
Honeyguide locally, gets a list, and wants to keep it, reopen it later, share
it with a colleague, and re-check it for link rot.

A true teaching-team collection feature — shared lists, view/edit roles,
comments, conflict handling — implies a very different product:

- a centralised server that stores collections for multiple users;
- identity and accounts (magic link or institutional SSO);
- permissions, sharing links and audit history;
- retention and deletion policy, and a real database.

Honeyguide is deliberately stateless today (ADR-0004, ADR-0008). Adding
accounts and shared storage is a large architectural change that is not
justified by current usage evidence.

## Decision

1. **Collections are portable files.** A collection is a versioned JSON
   document (`kind: honeyguide-collection`, `schemaVersion`, `topic`,
   `createdAt`, `result`). It can be saved from the web/desktop UI, written by
   the CLI (`suggest --collection`), opened again, and emailed or shared as a
   file.
2. **Rechecking is stateless.** `recheck` reads a collection (or legacy
   `suggest`/`batch` JSON), re-probes the links and reports changes. The
   server exposes the same operation at `POST /api/recheck`; nothing is
   persisted.
3. **No accounts, no shared storage, no permissions.** Those are explicitly
   out of scope until there is evidence a team actually needs sync.
4. **The file is the schema a future backend would store.** If shared team
   collections are built, a server can store these documents without
   reworking the client format.

## Consequences

- Works offline, on desktop, and in the hosted/self-host web UI; sharing is
  email/chat/file-transfer of a JSON document.
- No auth surface, no privacy policy for stored lists, no migration cost.
- No real-time collaboration, conflict resolution, comments or access
  control. A shared collection is a snapshot, not a living document.
- A future server-backed collections bet starts from a stable, versioned
  schema rather than inventing one under pressure.
