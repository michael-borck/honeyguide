import { checkUrl } from '@michaelborck/cite-sight-core';
import type { VerificationBasis, VerificationStatus } from '../types.js';
import type { Candidate } from '../retrieval/candidates.js';

export interface VerificationOutcome {
  status: VerificationStatus;
  basis: VerificationBasis;
}

/**
 * Map cite-sight-core's UrlStatus onto Honeyguide's VerificationStatus.
 * `unverified` means the check could not run or was inconclusive — never
 * silently upgraded (ADR-0006).
 */
export function mapUrlStatus(status: string): VerificationStatus {
  switch (status) {
    case 'live':
    case 'redirect':
      return 'verified';
    case 'blocked':
      return 'blocked';
    case 'dead':
      return 'dead';
    default:
      return 'unverified';
  }
}

/**
 * Human label that keeps the two verification bases distinct: a database
 * record is not the same claim as a live link.
 */
export function verificationText(
  status: VerificationStatus,
  basis: VerificationBasis,
): string {
  if (status !== 'verified') return status;
  return basis === 'database' ? 'record found' : 'link live';
}

export async function verifyCandidate(candidate: Candidate): Promise<VerificationOutcome> {
  // Academic-database results are existence-attested by retrieval itself:
  // the DOI/entry came out of Crossref/OpenAlex/iTunes/Open Library seconds
  // ago. Probing doi.org links additionally hits publisher bot-walls and
  // reports false "blocked". The basis records that distinction.
  if (candidate.databaseAttested) return { status: 'verified', basis: 'database' };
  try {
    const result = await checkUrl(candidate.url);
    return { status: mapUrlStatus(result.status), basis: 'url-check' };
  } catch {
    return { status: 'unverified', basis: 'none' };
  }
}
