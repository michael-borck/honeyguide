import type { SearchConstraints } from './types.js';
import type { Candidate } from './retrieval/candidates.js';

/** The four deterministic interview questions (ADR-0018). */
export interface BriefAnswers {
  stance: 'support' | 'challenge' | 'both';
  priorKnowledge: 'none' | 'reading' | 'lecture' | 'notes';
  /** Optional free-text clarification about prior knowledge. */
  priorNote?: string;
  timing: 'pre-class' | 'in-class' | 'post-class' | 'assessment';
  openAccessOnly?: boolean;
  noVideo?: boolean;
  recentOnly?: boolean;
}

export interface CompiledBrief {
  counterpoint: boolean;
  constraints: SearchConstraints;
  /** Teaching context passed to the annotator. Retrieval is unchanged. */
  context: string;
}

const PRIOR: Record<BriefAnswers['priorKnowledge'], string> = {
  none: 'Students have not encountered this topic yet.',
  reading: 'Students have already done a reading on this topic.',
  lecture: 'Students have already had a lecture on this topic.',
  notes: 'Students have their own notes on this topic.',
};

const TIMING: Record<BriefAnswers['timing'], string> = {
  'pre-class': 'This list is preparation before class.',
  'in-class': 'This list will be used during class.',
  'post-class': 'This list follows a class, for consolidation.',
  assessment: 'This list is for assessment preparation.',
};

const STANCE: Record<BriefAnswers['stance'], string> = {
  support: 'It should reinforce the current framing.',
  challenge: 'It should challenge the current framing and surface disagreement.',
  both: 'It should include both supporting material and counterpoints.',
};

/**
 * Turn the interview answers into the fields the pipeline already understands:
 * a counterpoint flag, search constraints and a teaching-context string.
 */
export function compileBrief(
  answers: BriefAnswers,
  currentYear: number = new Date().getFullYear(),
): CompiledBrief {
  const constraints: SearchConstraints = {};
  if (answers.openAccessOnly) constraints.openAccessOnly = true;
  if (answers.noVideo) constraints.excludeFormats = ['video'];
  if (answers.recentOnly) constraints.minYear = currentYear - 5;

  const note = answers.priorNote?.trim();
  const context = [
    PRIOR[answers.priorKnowledge],
    note || null,
    TIMING[answers.timing],
    STANCE[answers.stance],
  ]
    .filter(Boolean)
    .join(' ');

  return {
    counterpoint: answers.stance !== 'support',
    constraints,
    context,
  };
}

/**
 * Apply brief constraints to candidates before ranking. `openAccessOnly` is
 * best-effort: only papers explicitly flagged as subscription are dropped;
 * unknown access is kept (and labelled later).
 */
export function applyConstraints(
  candidates: Candidate[],
  constraints?: SearchConstraints,
): Candidate[] {
  if (!constraints) return candidates;
  const excluded = new Set(constraints.excludeFormats ?? []);
  return candidates.filter((candidate) => {
    if (excluded.has(candidate.format)) return false;
    if (
      constraints.minYear !== undefined &&
      candidate.year !== null &&
      candidate.year < constraints.minYear
    ) {
      return false;
    }
    if (
      constraints.openAccessOnly &&
      candidate.format === 'paper' &&
      candidate.licensing === 'library-subscription'
    ) {
      return false;
    }
    return true;
  });
}
