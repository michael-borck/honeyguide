# 0018. Interview mode: a deterministic retrieval brief, not a chatbot

**Status:** Accepted
**Date:** 2026-11-11

## Context

ADR-0009 deferred interview mode until list-mode usage showed where lecturers
actually need prompting. List mode, counterpoint, outcome alignment and local
decision models now exist, and the plan (Bet 3) defines a low-friction
interview: four questions, then a better first list.

The risk is friction. A conversational assistant would be slower, harder to
evaluate and would put generated prose between the lecturer and the retrieval.
The useful part is not dialogue; it is capturing the brief the lecturer
already has in their head.

## Decision

1. **One optional screen, four questions.** A deterministic state machine — not
   a chatbot, not free-form dialogue:
   - stance: support the framing / challenge it / both;
   - prior knowledge: nothing / a reading / a lecture / their notes (+ note);
   - timing: before class / in class / after class / assessment;
   - constraints: open access only / no video / published recently.
2. **Answers compile to a brief** with three outputs:
   - `counterpoint` (stance);
   - `constraints` (`excludeFormats`, `minYear`, best-effort
     `openAccessOnly`);
   - `context`, a short teaching-context string passed to the rationale
     annotator. Retrieval queries themselves are unchanged.
3. **Constraints are applied before ranking.** Excluded formats and old years
   are dropped; `openAccessOnly` drops papers explicitly flagged as
   subscription, while unknown access is kept and labelled later. Streaming
   over-filtering is worse than an honest unknown.
4. **The brief is visible and editable.** It is stored in browser storage and
   in the portable collection file. "Skip" always returns to list mode; list
   mode remains the default.
5. **No LLM is required to conduct the interview.** The local LLM only uses
   the compiled context when writing rationales, if one is configured.
6. **The brief is scriptable.** The CLI exposes the constraint/context subset
   (`--open-access`, `--no-video`, `--since`, `--context`); the four-question
   flow itself is a UI affordance.

## Consequences

- A lecturer can ask for "challenge it, open access only, before class" and get
  a differently framed list without writing a prompt.
- The stance "challenge" and "both" set counterpoint mode. The pipeline still
  returns the supporting list alongside the labelled counterpoint section; a
  challenge-only list would be a separate retrieval mode.
- Constraint application is testable and deterministic; no model call is
  needed to filter.
- Friction is mitigated by Skip, a single screen, remembered answers, and the
  brief summary in the control row.
- A quality A/B against list mode (plan milestone 4) is still needed; the
  brief is a structured request, not a proven improvement yet.
