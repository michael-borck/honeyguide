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

1. **Outcomes are user-supplied text.** A textarea accepts a plain list or a
   pasted unit outline. When an "Outcomes" heading exists, only that section
   is used; headings such as Week/Module/Assessment are ignored, and list
   markers, numbering and LO/CLO codes are stripped. Ids are assigned
   (`o0`, `o1`…). They persist in browser storage and in the collection file.
   No server-side unit database.
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
6. **One-line reasons are optional.** When a local LLM is configured
   (`OLLAMA_URL`), up to six proposals get a short generated reason ("how this
   resource helps students meet the outcome"). Reasons are labelled generated
   in the UI and exports, are capped for latency, and are skipped entirely with
   `HONEYGUIDE_ALIGNMENT_REASONS=0` or when no LLM is available.
7. **Export reflects the screen.** `POST /api/export` renders Markdown, LMS
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
- Generated reasons add latency on a local LLM and can repeat inaccuracies
  from the resource annotation, so they are labelled generated and only shown
  in exports after the human confirms the alignment.

## Evaluation

`npm run eval:alignment` runs a hand-labelled set (`eval/alignment-set.json`,
25 resources across three outcome sets) against the configured aligner. With
`tev1:0.8b` it reported **84% accuracy, 94% precision, 79% recall, 100%
abstention on non-matching resources**, at ~2.5s mean per case. The misses
were mostly the "evaluate/apply" outcome level; the one wrong answer was a
near-neighbour pair (vulnerability vs resilience). `--strict` fails below 80%
accuracy.
