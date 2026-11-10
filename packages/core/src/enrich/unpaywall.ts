import type { AccessStatus } from '../types.js';

const ENDPOINT = 'https://api.unpaywall.org/v2';
const TIMEOUT_MS = 4000;

export interface UnpaywallInfo {
  access: AccessStatus;
  /** Best free-to-read location, when Unpaywall reports one. */
  oaUrl?: string;
  license?: string;
}

interface UnpaywallResponse {
  is_oa?: boolean;
  best_oa_location?: {
    url?: string;
    license?: string;
  } | null;
}

/**
 * Map Unpaywall's response to Honeyguide's access status. Anything other
 * than an explicit `is_oa: true` is treated as subscription, because
 * Unpaywall only reports papers it knows about — an unknown DOI never gets
 * here (the HTTP call fails first).
 */
export function mapUnpaywallResponse(data: UnpaywallResponse): UnpaywallInfo {
  const oaUrl = data.best_oa_location?.url;
  const license = data.best_oa_location?.license;
  return {
    access: data.is_oa ? 'open' : 'subscription',
    oaUrl: typeof oaUrl === 'string' ? oaUrl : undefined,
    license: typeof license === 'string' ? license : undefined,
  };
}

/**
 * Query Unpaywall for a DOI (spec §3 institutional plumbing). Free and
 * keyless, but it requires a contact email; without `HONEYGUIDE_MAILTO` the
 * caller should skip this. Failure is non-fatal (ADR-0006).
 */
export async function lookupUnpaywall(
  doi: string,
  email: string,
): Promise<UnpaywallInfo | null> {
  if (!doi || !email) return null;
  const path = doi.split('/').map(encodeURIComponent).join('/');
  const url = `${ENDPOINT}/${path}?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Honeyguide/1.0' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return mapUnpaywallResponse((await res.json()) as UnpaywallResponse);
}
