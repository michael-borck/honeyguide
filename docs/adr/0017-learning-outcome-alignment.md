# 0017. Learning-outcome alignment: local judgments, human confirmation

**Status:** Accepted
**Date:** 2026-11-11

## Context

The list tells a lecturer what a resource is; it does not say which outcome
the resource serves. From the audit (Bet 1), alignment is the most
teaching-specific signal and the hardest for a generic tool to copy.

The personal/desktop constraint matters. There is no account, server-side
unit store, or shared database (ADR-0014). Outcomes must travel with the user:
in browser storage and inside the portable collection file.

The app already has local judgment engines: a System One decision model
(Ollama `/v1/systemone`, ADR-0016) and embedding similarity (ADR-0015). Both
can compare a resource to a short list of outcome statements without a cloud
call.

## Decision

1. **Outcomes are user-supplied text.** A textarea accepts one outcome per
   line; labels and numbering are stripped and ids are assigned (`o0`, `o1`…).
   They persist in browser storage and in the collection file. No server-side
   unit database.
2. **Alignment is a proposal, not a fact.** The pipeline attaches an
   `Alignment` to a resource:
   `{ outcomeId, outcomeText, score, confidence, proposedBy, confirmed }`.
   `confirmed` starts false. The model never invents outcomes, only chooses
   among the supplied ones (or `none`).
3. **Decision model first, embeddings second.** A local System One model gets
   one Choice question per resource over the outcome list plus `none`
   (`tev1:0.8b` default). Choice probabilities are used:
   - a chosen outcome is proposed;
   - when the model chooses `none` but a real outcome is close
     (probability ≥ 0.35 and within 20% of `none`), keep it as a
     low-confidence proposal rather than discarding a near-tie.
   If no decision model is configured, cosine similarity between resource and
   outcome text is the fallback. With neither, alignment reports unavailable.
4. **Human confirmation is mandatory for export.** The UI shows the proposed
   outcome, confidence and score with a Confirm toggle. Markdown and LMS HTML
   exports include only confirmed alignments; proposed-but-unconfirmed ones
   are visible in the app but never presented as fact in a document.
5. **Bounds and non-fatal behaviour.** Up to 12 resources and 8 outcomes per
   request; text is truncated. Any model or network failure leaves
   `alignment: null` and reports `alignment` in `componentHealth`.
6. **Export reflects the screen.** `POST /api/export` renders Markdown, LMS
   HTML, APA or Harvard from the result the client is showing, so confirmed
   alignments are honoured without re-running retrieval.

## Consequences

- Lecturers get a direct "which outcome does this serve?" answer, with a
  human check before anything leaves the app.
- Outcomes and confirmations are portable: they travel in the collection file
  and can be emailed/shared, with no accounts or sync.
- Alignment quality depends on the local model. The UI labels confidence and
  requires confirmation; a wrong proposal costs a click, not a bad export.
- The 12-resource cap keeps the decision-model prompt within its comfortable
  context; additional resources simply have no proposal.
- A future server-backed team feature can store the same outcome list and
  alignments; no schema rewrite is needed.
