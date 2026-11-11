import type { Outcome, Resource, SuggestResult } from './types.js';

/**
 * Portable collection format (ADR-0014). A collection is a saved result list
 * that can be reopened, rechecked and shared as a file — no server, accounts
 * or permissions involved. The same document is what a future team backend
 * would store, so the format is versioned from day one.
 */
export const COLLECTION_KIND = 'honeyguide-collection';
export const COLLECTION_SCHEMA_VERSION = 1;

export interface CollectionFile {
  kind: typeof COLLECTION_KIND;
  schemaVersion: number;
  topic: string;
  /** ISO timestamp of when the list was generated. */
  createdAt: string;
  /** Unit outcomes the list was aligned to, when supplied (ADR-0017). */
  outcomes?: Outcome[];
  result: SuggestResult;
}

export function toCollectionFile(
  topic: string,
  result: SuggestResult,
  outcomes: Outcome[] = [],
  now: Date = new Date(),
): CollectionFile {
  return {
    kind: COLLECTION_KIND,
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    topic: topic.trim(),
    createdAt: now.toISOString(),
    ...(outcomes.length ? { outcomes } : {}),
    result: portable(result),
  };
}

/**
 * Collections are files people email to each other. Desktop screenshots are
 * embedded data URLs and can be many megabytes, so they are dropped; ordinary
 * http(s) thumbnail URLs are kept.
 */
function portable(result: SuggestResult): SuggestResult {
  return {
    ...result,
    resources: result.resources.map((resource) => ({
      ...resource,
      thumbnailUrl:
        resource.thumbnailUrl && !resource.thumbnailUrl.startsWith('data:')
          ? resource.thumbnailUrl
          : null,
    })),
  };
}

/** Parse and validate a collection file; throws with a user-facing message. */
export function parseCollectionFile(input: string | unknown): CollectionFile {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      throw new Error('Not valid JSON — expected a Honeyguide collection file.');
    }
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Not a Honeyguide collection file.');
  }
  const obj = data as Partial<CollectionFile>;
  if (obj.kind !== COLLECTION_KIND) {
    throw new Error('Not a Honeyguide collection file.');
  }
  if (typeof obj.schemaVersion !== 'number') {
    throw new Error('Collection file is missing its schema version.');
  }
  if (obj.schemaVersion > COLLECTION_SCHEMA_VERSION) {
    throw new Error(
      `Collection schema v${obj.schemaVersion} is newer than this app supports (v${COLLECTION_SCHEMA_VERSION}). Update Honeyguide.`,
    );
  }
  if (!obj.result || !Array.isArray(obj.result.resources)) {
    throw new Error('Collection file is missing its resources.');
  }
  const outcomes = Array.isArray(obj.outcomes)
    ? obj.outcomes
        .filter(
          (outcome): outcome is Outcome =>
            Boolean(outcome) &&
            typeof (outcome as Outcome).id === 'string' &&
            typeof (outcome as Outcome).text === 'string',
        )
        .map((outcome) => ({ id: outcome.id, text: outcome.text }))
    : [];
  return {
    kind: COLLECTION_KIND,
    schemaVersion: obj.schemaVersion,
    topic: typeof obj.topic === 'string' ? obj.topic : '',
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : nowIso(),
    ...(outcomes.length ? { outcomes } : {}),
    result: obj.result as SuggestResult,
  };
}

/**
 * Read resources from any saved Honeyguide JSON: a collection file, a legacy
 * `suggest --json` result, or a batch output. Used by recheck.
 */
export function resourcesFromSaved(input: unknown): Resource[] {
  const obj = input as {
    kind?: string;
    resources?: Resource[];
    entries?: Array<{ result?: { resources?: Resource[] } }>;
  } | null;
  if (!obj || typeof obj !== 'object') return [];
  if (obj.kind === COLLECTION_KIND) return parseCollectionFile(obj).result.resources;
  if (Array.isArray(obj.resources)) return obj.resources;
  if (Array.isArray(obj.entries)) {
    return obj.entries.flatMap((entry) => entry?.result?.resources ?? []);
  }
  return [];
}

function nowIso(): string {
  return new Date().toISOString();
}
