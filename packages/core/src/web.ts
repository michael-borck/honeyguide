/**
 * Browser-safe entrypoint for the shared logic the web UI needs. This module
 * must NOT (transitively) import any Node built-in: it is bundled into the
 * browser app. Keep node-only code (fs, dns, the SSRF/net helpers, verification
 * probes) out of the modules re-exported here.
 *
 * The web package previously copy-pasted these helpers to avoid pulling the
 * whole core (and its Node-only verification code) into the bundle. This entry
 * lets it share one implementation instead.
 */

export type {
  Outcome,
  Alignment,
  Annotation,
  Resource,
  ResourceFormat,
  SourceType,
  SearchConstraints,
  SuggestResult,
  VerificationStatus,
  VerificationBasis,
  ProgressEvent,
  PipelineStage,
} from './types.js';

export type { BatchEntry } from './batch.js';

export {
  COLLECTION_KIND,
  COLLECTION_SCHEMA_VERSION,
  toCollectionFile,
  parseCollectionFile,
  type CollectionFile,
} from './collection.js';

export {
  compileBrief,
  briefSummary,
  applyConstraints,
  type BriefAnswers,
  type CompiledBrief,
} from './brief.js';

export { parseOutcomes } from './align/outcomesParse.js';
export { mapUrlStatus, verificationText } from './verify/labels.js';
export { clamp, mapLimit } from './util.js';