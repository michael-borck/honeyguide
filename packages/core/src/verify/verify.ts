import type { VerificationBasis, VerificationStatus } from '../types.js';
import type { Candidate } from '../retrieval/candidates.js';
import { safeFetch } from '../net/ssrf.js';
import { mapUrlStatus, verificationText } from './labels.js';

export { mapUrlStatus, verificationText };

export interface VerificationOutcome {
  status: VerificationStatus;
  basis: VerificationBasis;
}

const PROBE_TIMEOUT_MS = 8000;
const PROBE_HEADERS = {
  'user-agent': 'honeyguide/0.7 (+https://github.com/michael-borck/honeyguide)',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/** The status a URL probe resolved to, before mapping to VerificationStatus. */
export type UrlProbeStatus = 'live' | 'redirect' | 'blocked' | 'dead' | 'timeout' | 'unverified';

export interface UrlProbe {
  status: UrlProbeStatus;
  finalUrl?: string;
}

/**
 * GET a URL with a full SSRF guard (DNS + per-hop redirect revalidation) and
 * classify the result. A private/unresolvable target is reported as `blocked`
 * rather than followed.
 */
export async function probeUrl(raw: string, allowPrivate = false): Promise<UrlProbe> {
  try {
    const res = await safeFetch(
      raw,
      { method: 'GET', headers: PROBE_HEADERS, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
      { allowPrivate },
    );
    const finalUrl = res.url && res.url !== raw ? res.url : undefined;
    if (res.status >= 200 && res.status < 300) return { status: 'live', finalUrl };
    if (res.status >= 300 && res.status < 400) {
      // 304 is a cache revalidation on a resource that still exists.
      return { status: res.status === 304 ? 'live' : 'redirect', finalUrl };
    }
    // Only 404/410 mean the resource is genuinely gone. 401/403/429/451 and
    // other 4xx/5xx mean the server declined an automated client — the resource
    // is reachable but unverifiable, NOT dead (publishers routinely 403 bots).
    if (res.status === 404 || res.status === 410) return { status: 'dead', finalUrl };
    return { status: 'blocked', finalUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('Refusing')) return { status: 'blocked' };
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      return { status: 'timeout' };
    }
    return { status: 'unverified' };
  }
}

export interface VerifyOptions {
  /** Allow private/reserved targets (desktop/localhost only). */
  allowPrivate?: boolean;
}

export async function verifyCandidate(
  candidate: Candidate,
  options: VerifyOptions = {},
): Promise<VerificationOutcome> {
  // Academic-database results are existence-attested by retrieval itself:
  // the DOI/entry came out of Crossref/OpenAlex/iTunes/Open Library seconds
  // ago. Probing doi.org links additionally hits publisher bot-walls and
  // reports false "blocked". The basis records that distinction.
  if (candidate.databaseAttested) return { status: 'verified', basis: 'database' };
  const probe = await probeUrl(candidate.url, options.allowPrivate);
  return { status: mapUrlStatus(probe.status), basis: 'url-check' };
}