import {
  searchCrossref,
  searchSemanticScholar,
  type AcademicWork,
} from '@michaelborck/cite-sight-core';
import { searchOpenAlexTopical } from './openalexTopical.js';
import { searchEuropePmc } from './europePmc.js';
import { searchArxiv } from './arxiv.js';
import { mergePaperCandidates, normalizeDoi } from './paperMerge.js';
import type { Candidate } from './candidates.js';

export interface PaperRetrievalOptions {
  mailto?: string;
  /** Lifts Semantic Scholar's keyless shared-pool throttling. */
  semanticScholarApiKey?: string;
}

/**
 * Bound each source so a slow or rate-limited API cannot dominate latency.
 * Paper sources run in parallel, so the request costs roughly the slowest one.
 */
const SOURCE_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = promise.catch(() => fallback);
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([guarded, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Multi-source paper discovery (ADR-0013). OpenAlex, Semantic Scholar, Europe
 * PMC and arXiv run in parallel and are merged; Crossref is the last-resort
 * fallback when every source returns nothing. One source failing never fails
 * the request (ADR-0006), and results are database-attested by construction.
 */
export async function retrievePapers(
  topic: string,
  options: PaperRetrievalOptions = {},
): Promise<Candidate[]> {
  const settled = await Promise.allSettled([
    withTimeout(searchOpenAlexTopical(topic, options.mailto), SOURCE_TIMEOUT_MS, [] as Candidate[]),
    withTimeout(
      searchSemanticScholar(topic, options.semanticScholarApiKey).then((works) =>
        worksToCandidates(works, 'semantic-scholar'),
      ),
      SOURCE_TIMEOUT_MS,
      [] as Candidate[],
    ),
    withTimeout(searchEuropePmc(topic), SOURCE_TIMEOUT_MS, [] as Candidate[]),
    withTimeout(searchArxiv(topic), SOURCE_TIMEOUT_MS, [] as Candidate[]),
  ]);

  const lists = settled.flatMap((outcome) =>
    outcome.status === 'fulfilled' ? [outcome.value] : [],
  );
  const merged = mergePaperCandidates(lists);
  if (merged.length > 0) return merged;

  const works = await searchCrossref(topic, options.mailto);
  return mergePaperCandidates([worksToCandidates(works, 'crossref')]);
}

function worksToCandidates(
  works: AcademicWork[],
  origin: 'semantic-scholar' | 'crossref',
): Candidate[] {
  return works.flatMap((work): Candidate[] => {
    const title = work.title?.trim();
    if (!title) return [];
    const doi = normalizeDoi(work.doi);
    const url = (doi ? `https://doi.org/${doi}` : undefined) ?? work.url;
    if (!url) return [];
    return [
      {
        title,
        url,
        format: 'paper',
        authors: work.authors ?? [],
        year: work.year ?? null,
        doi,
        venue: work.journal,
        origin,
        databaseAttested: true,
      },
    ];
  });
}
