import type { Outcome } from '../types.js';

const OUTCOMES_HEADING =
  /^(?:(?:learning|intended|course|unit|subject|module|program|programme|graduate)\s+)*outcomes?$|^(?:ilos?|clos?|ulos?|slos?)$/i;
const OTHER_HEADING =
  /^(?:week|module|topic|unit|lecture|seminar|workshop|assessment|assessments|resources|readings?|activities|schedule|content|description|overview|introduction)\b/i;

/**
 * Extract outcomes from a plain list or a pasted unit outline. When an
 * "Outcomes" heading is present, only that section is used; otherwise every
 * non-structural line is a candidate. List markers, numbering and outcome
 * codes (LO1, CLO2…) are stripped.
 *
 * Pure and DOM-free so the web UI can share this exact implementation via the
 * `@michaelborck/honeyguide-core/web` entry.
 */
export function parseOutcomes(text: string): Outcome[] {
  const lines = text.split(/\r?\n/);
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (OUTCOMES_HEADING.test(heading(lines[i]))) {
      start = i + 1;
      break;
    }
  }
  const hasOutcomesHeading = start > 0;
  const seen = new Set<string>();
  const texts: string[] = [];

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const clean = heading(line);
    if (OUTCOMES_HEADING.test(clean)) continue;
    if (OTHER_HEADING.test(clean)) {
      if (hasOutcomesHeading) break;
      continue;
    }
    const outcome = stripPrefix(line);
    if (outcome.length < 8) continue;
    const key = outcome.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    texts.push(outcome);
  }

  return texts.map((outcomeText, index) => ({ id: `o${index}`, text: outcomeText }));
}

/** A line reduced to its section-heading text, or '' if it is not a heading. */
function heading(line: string): string {
  return line
    .replace(/^[#*\s]+/, '')
    .replace(/[*\s]+$/, '')
    .replace(/:$/, '')
    .trim();
}

function stripPrefix(line: string): string {
  return line
    .replace(/^\s*(?:[-*•·▪]|\d+(?:\.\d+)*[.)]?)\s*/, '')
    .replace(/^(?:LO|ILO|CLO|ULO|SLO)\s*\d+\s*[:.)-]?\s*/i, '')
    .replace(/^students?\s+(?:will|should)\s+be\s+able\s+to\s+/i, '')
    .replace(/^students?\s+can\s+/i, '')
    .replace(/^be\s+able\s+to\s+/i, '')
    .trim();
}