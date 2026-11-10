import { fetchJson, type Candidate } from './candidates.js';
import { normalizeDoi } from './paperMerge.js';
import { throttle } from './rateLimit.js';

const ENDPOINT = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const SERVICE = 'europepmc';
const MIN_INTERVAL_MS = 1000;

interface EpmcAuthor {
  fullName?: string;
  lastName?: string;
  firstName?: string;
  collectiveName?: string;
}

interface EpmcResult {
  id?: string;
  source?: string;
  title?: string;
  doi?: string;
  pubYear?: string;
  authorList?: { author?: EpmcAuthor[] };
  journalInfo?: { journal?: { title?: string } };
  abstractText?: string;
  isOpenAccess?: string;
}

/**
 * Europe PMC (ADR-0013): strong biomedical coverage and keyless. Used as a
 * discovery source, not just a verification lookup, so the query is the topic
 * rather than an exact title.
 */
export async function searchEuropePmc(topic: string): Promise<Candidate[]> {
  await throttle(SERVICE, MIN_INTERVAL_MS);
  const params = new URLSearchParams({
    query: topic,
    format: 'json',
    resultType: 'core',
    pageSize: '8',
  });
  const data = (await fetchJson(`${ENDPOINT}?${params}`, {
    'user-agent': 'Honeyguide/1.0',
  })) as { resultList?: { result?: EpmcResult[] } };
  return parseEuropePmcResults(data.resultList?.result ?? []);
}

export function parseEuropePmcResults(results: EpmcResult[]): Candidate[] {
  return results.flatMap((r): Candidate[] => {
    const title = clean(r.title);
    if (!title) return [];
    const doi = normalizeDoi(r.doi);
    const url =
      (doi ? `https://doi.org/${doi}` : undefined) ??
      (r.id && r.source
        ? `https://europepmc.org/article/${encodeURIComponent(r.source)}/${encodeURIComponent(r.id)}`
        : undefined);
    if (!url) return [];
    return [
      {
        title,
        url,
        format: 'paper',
        authors: (r.authorList?.author ?? [])
          .map(
            (a) =>
              a.collectiveName ||
              [a.lastName, a.firstName].filter(Boolean).join(', ') ||
              a.fullName ||
              '',
          )
          .filter(Boolean),
        year: /^\d{4}$/.test(r.pubYear ?? '') ? Number(r.pubYear) : null,
        doi,
        description: r.abstractText ? clean(r.abstractText).slice(0, 600) : undefined,
        venue: r.journalInfo?.journal?.title,
        ...(r.isOpenAccess === 'Y' ? { licensing: 'link-only' as const } : {}),
        origin: 'europepmc',
        databaseAttested: true,
      },
    ];
  });
}

function clean(s?: string): string {
  return (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
