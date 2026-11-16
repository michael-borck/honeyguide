import type { VerificationBasis, VerificationStatus } from '../types.js';

/**
 * Map a URL-probe status onto Honeyguide's VerificationStatus. `unverified`
 * means the check could not run or was inconclusive — never silently upgraded
 * (ADR-0006). Kept free of network/Node imports so the browser bundle can use
 * it directly.
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