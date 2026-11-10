import type { LicensingStatus, ResourceFormat } from '../types.js';
import { getCachedJson, setCachedJson } from './cache.js';
import { defaultBreaker } from './breaker.js';

/** A retrieved-but-not-yet-enriched resource. */
export interface Candidate {
  title: string;
  url: string;
  format: ResourceFormat;
  authors: string[];
  year: number | null;
  doi?: string;
  /** Journal, publisher or channel, when the source provides it. */
  venue?: string;
  /** Licensing signal from the retrieval source (spec §3: institutional plumbing). */
  licensing?: LicensingStatus;
  accessibilityNotes?: string[];
  /** Description text supplied by the retrieval source, if any (ADR-0011 rung 2). */
  description?: string;
  thumbnailUrl?: string;
  /** Where this candidate came from, for provenance and source-typing. */
  origin:
    | 'openalex'
    | 'crossref'
    | 'semantic-scholar'
    | 'europepmc'
    | 'arxiv'
    | 'itunes'
    | 'openlibrary'
    | 'youtube'
    | 'searxng'
    | 'brave'
    | 'serper';
  /** True when the origin is an academic database, so existence is already attested. */
  databaseAttested: boolean;
}

const FETCH_TIMEOUT_MS = 8000;

export async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const cached = getCachedJson<unknown>(url);
  if (cached !== undefined) return cached;

  let host = 'unknown';
  try {
    host = new URL(url).host;
  } catch {
    // Let fetch() report the malformed URL below.
  }
  if (!defaultBreaker.canRequest(host)) {
    throw new Error(`Skipping ${host}: recent failures (circuit open)`);
  }

  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${host}`);
    const data = await res.json();
    setCachedJson(url, data);
    defaultBreaker.recordSuccess(host);
    return data;
  } catch (error) {
    defaultBreaker.recordFailure(host);
    throw error;
  }
}
