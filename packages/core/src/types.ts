export type SourceType =
  | 'peer-reviewed'
  | 'practitioner'
  | 'vendor'
  | 'journalism'
  | 'government';

export type ResourceFormat =
  | 'video'
  | 'website'
  | 'podcast'
  | 'paper'
  | 'white-paper'
  | 'report'
  | 'book';

/**
 * Verification outcome for a single resource. Per ADR-0006, `unverified`
 * (the check could not run) is distinct from `dead` (the check ran and the
 * resource is gone). Unverifiable resources are flagged, never hidden.
 */
export type VerificationStatus =
  | 'verified'
  | 'paywalled'
  | 'blocked'
  | 'dead'
  | 'unverified';

/**
 * How verification was established. `database` means the record came out of a
 * database seconds earlier (existence attested); `url-check` means a live HTTP
 * probe ran; `none` means neither could be done. The distinction matters: a
 * database record can still sit behind a paywall.
 */
export type VerificationBasis = 'database' | 'url-check' | 'none';

/** Access status for a paper: freely readable, subscription, or unknown. */
export type AccessStatus = 'open' | 'subscription' | 'unknown';

export type LicensingStatus =
  | 'oer'
  | 'creative-commons'
  | 'library-subscription'
  | 'link-only'
  | 'unknown';

/**
 * Which rung of the annotation ladder produced the text (ADR-0011):
 * 'llm' is a relational rationale, 'extracted' is a descriptive fallback
 * (og:description, abstract, RSS summary), 'none' means neither was
 * available. UIs must render the distinction — an extracted description is
 * never presented as a generated rationale.
 */
export type AnnotationSource = 'llm' | 'extracted' | 'none';

export interface Annotation {
  source: AnnotationSource;
  /** Rationale or description; null when source is 'none'. */
  text: string | null;
}

/**
 * Whether a resource supports the input's framing or was deliberately
 * retrieved to challenge it (counterpoint mode, spec §3 point 3).
 */
export type Stance = 'supporting' | 'counterpoint';

/** A unit learning outcome, used for optional alignment (ADR-0017). */
export interface Outcome {
  id: string;
  text: string;
}

export type AlignmentConfidence = 'high' | 'medium' | 'low';

/**
 * A proposed link between a resource and an outcome. The model proposes; the
 * human confirms. Only confirmed alignments are exported.
 */
export interface Alignment {
  outcomeId: string;
  /** Copied so collections and exports are self-contained. */
  outcomeText: string;
  /** Choice probability or embedding similarity, 0..1. */
  score: number;
  confidence: AlignmentConfidence;
  proposedBy: 'decision' | 'embeddings';
  confirmed: boolean;
}

export interface Resource {
  stance: Stance;
  title: string;
  url: string;
  format: ResourceFormat;
  sourceType: SourceType;
  authors: string[];
  year: number | null;
  /** Journal, publisher or channel, when known. */
  venue: string | null;
  verification: VerificationStatus;
  /** How that verification was established (database vs URL probe). */
  verificationBasis: VerificationBasis;
  /** Paper access status; 'unknown' for non-papers or when no signal exists. */
  access: AccessStatus;
  /** Consultant reports are marketing artefacts as often as evidence. */
  commerciallyInterested: boolean;
  licensing: LicensingStatus;
  /** Why this one, what it adds, what it does not cover — or an extractive description (ADR-0011). */
  annotation: Annotation;
  /** oEmbed or og:image URL; null when unavailable (ADR-0005). */
  thumbnailUrl: string | null;
  accessibilityNotes: string[];
  /** Proposed outcome alignment, if the request supplied outcomes (ADR-0017). */
  alignment: Alignment | null;
}

export interface SuggestRequest {
  /** A topic string, or extracted text from an uploaded document. */
  input: string;
  maxResults?: number;
  /**
   * Counterpoint mode: additionally retrieve material that disagrees with
   * or complicates the input's framing, clearly labelled (spec §3).
   */
  counterpoint?: boolean;
  /** Optional unit outcomes; when present the pipeline proposes alignments. */
  outcomes?: Outcome[];
}

export type ComponentState = 'ok' | 'degraded' | 'unavailable';

export interface SuggestResult {
  resources: Resource[];
  /** Health of each enrichment component for this request (ADR-0006). */
  componentHealth: Record<string, ComponentState>;
}
