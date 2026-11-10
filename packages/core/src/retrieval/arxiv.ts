import type { Candidate } from './candidates.js';
import { extractPhrases } from './query.js';
import { throttle } from './rateLimit.js';

const ENDPOINT = 'https://export.arxiv.org/api/query';
const API_TIMEOUT_MS = 10_000;
const SERVICE = 'arxiv';
// arXiv's terms of use ask for at most one request every three seconds.
const MIN_INTERVAL_MS = 3100;

export interface ArxivEntry {
  title: string;
  authors: string[];
  year: number | null;
  /** Canonical abs URL, without a version suffix. */
  url: string;
  summary?: string;
}

/**
 * arXiv preprint discovery (ADR-0013). Preprints are a structural blind spot
 * for Crossref/OpenAlex discovery, and the Atom API is keyless and
 * authoritative for its own corpus.
 */
export async function searchArxiv(topic: string): Promise<Candidate[]> {
  await throttle(SERVICE, MIN_INTERVAL_MS);
  const searchQuery = buildArxivQuery(topic);
  if (!searchQuery) return [];
  const params = new URLSearchParams({
    search_query: searchQuery,
    start: '0',
    max_results: '8',
  });
  const res = await fetch(`${ENDPOINT}?${params}`, {
    headers: { accept: 'application/atom+xml', 'user-agent': 'Honeyguide/1.0' },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from arxiv.org`);
  return arxivEntriesToCandidates(parseArxivFeed(await res.text()));
}

/**
 * arXiv treats a bare multi-word phrase as an impossible exact match, so
 * build a phrase query from the topic's content phrases and OR them, the same
 * way OpenAlex and Open Library are queried.
 */
export function buildArxivQuery(topic: string): string {
  const phrases = extractPhrases(topic, 3);
  if (phrases.length) {
    return phrases.map((p) => `all:"${p}"`).join(' OR ');
  }
  const fallback = topic.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return fallback ? `all:${fallback}` : '';
}

/** Parse the flat, machine-generated Atom feed without an XML dependency. */
export function parseArxivFeed(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = match[1];
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    if (!title) continue;
    const id = block.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/)?.[1];
    if (!id) continue;
    const published = block.match(/<published>(\d{4})-/)?.[1];
    const summary = block.match(/<summary>([\s\S]*?)<\/summary>/)?.[1];
    entries.push({
      title: clean(decodeXmlEntities(title)),
      authors: [...block.matchAll(/<name>([\s\S]*?)<\/name>/g)]
        .map((a) => clean(decodeXmlEntities(a[1])))
        .filter(Boolean),
      year: published ? Number(published) : null,
      url: `https://arxiv.org/abs/${id.replace(/v\d+$/, '')}`,
      summary: summary ? clean(decodeXmlEntities(summary)) : undefined,
    });
  }
  return entries;
}

export function arxivEntriesToCandidates(entries: ArxivEntry[]): Candidate[] {
  return entries.map(
    (entry): Candidate => ({
      title: entry.title,
      url: entry.url,
      format: 'paper',
      authors: entry.authors,
      year: entry.year,
      description: entry.summary ? entry.summary.slice(0, 600) : undefined,
      // arXiv preprints are freely readable by definition.
      licensing: 'link-only',
      origin: 'arxiv',
      databaseAttested: true,
    }),
  );
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
