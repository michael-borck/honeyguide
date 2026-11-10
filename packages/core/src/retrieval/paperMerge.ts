import type { Candidate } from './candidates.js';

/**
 * Canonical DOI form for matching: no resolver prefix, no `doi:` label,
 * lower-case. Everything downstream compares on this.
 */
export function normalizeDoi(doi?: string | null): string | undefined {
  if (!doi) return undefined;
  const cleaned = doi
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim();
  return cleaned ? cleaned.toLowerCase() : undefined;
}

/** Title key for matching when a DOI is unavailable. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Merge paper candidates from several databases (ADR-0013). Duplicates are
 * matched by normalised DOI first, then by normalised title, so a DOI-less
 * arXiv record and a Crossref record for the same paper collapse into one.
 * The first occurrence wins for conflicting fields; missing fields are filled
 * from later duplicates.
 */
export function mergePaperCandidates(lists: Candidate[][]): Candidate[] {
  const out: Candidate[] = [];
  const byDoi = new Map<string, Candidate>();
  const byTitle = new Map<string, Candidate>();

  for (const list of lists) {
    for (const candidate of list) {
      const titleKey = normalizeTitle(candidate.title);
      if (!titleKey) continue;
      const doi = normalizeDoi(candidate.doi);

      const existing =
        (doi ? byDoi.get(doi) : undefined) ?? byTitle.get(titleKey);
      if (!existing) {
        const copy: Candidate = {
          ...candidate,
          doi,
          accessibilityNotes: candidate.accessibilityNotes
            ? [...candidate.accessibilityNotes]
            : undefined,
        };
        out.push(copy);
        byTitle.set(titleKey, copy);
        if (doi) byDoi.set(doi, copy);
        continue;
      }

      mergeInto(existing, candidate, doi);
      byTitle.set(titleKey, existing);
      if (doi) byDoi.set(doi, existing);
    }
  }

  return out;
}

function mergeInto(target: Candidate, extra: Candidate, doi?: string): void {
  if (!target.authors.length && extra.authors.length) target.authors = extra.authors;
  if (target.year == null && extra.year != null) target.year = extra.year;
  target.doi ??= doi ?? extra.doi;
  target.venue ??= extra.venue;
  target.licensing ??= extra.licensing;
  target.description ??= extra.description;
  target.thumbnailUrl ??= extra.thumbnailUrl;
  if (!target.accessibilityNotes?.length && extra.accessibilityNotes?.length) {
    target.accessibilityNotes = extra.accessibilityNotes;
  }
}
