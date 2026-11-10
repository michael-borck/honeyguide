import type { Candidate } from '../retrieval/candidates.js';
import type { Reranker } from './reranker.js';

const TIMEOUT_MS = 30_000;
// Tev1 runs with a ~2k-token context and the docs advise short inputs, so
// score a bounded shortlist with truncated metadata.
export const MAX_DECISION_CANDIDATES = 16;
const MAX_TITLE_CHARS = 180;
const MAX_DESCRIPTION_CHARS = 240;

export interface SystemOneCandidate {
  id: string;
  title: string;
  venue?: string;
  description?: string;
}

export interface SystemOneQuestion {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
}

export interface SystemOneRequest {
  model: string;
  state: { topic: string; candidates: SystemOneCandidate[] };
  questions: Record<string, SystemOneQuestion>;
  keep_alive: string;
}

export interface BuiltSystemOneRequest {
  request: SystemOneRequest;
  idToCandidate: Map<string, Candidate>;
}

/**
 * Pick a bounded shortlist that still represents every format. Retrieval
 * returns papers first, so a naive slice would spend the whole decision-model
 * budget on papers and leave the podcasts/books that diversity will also pick
 * unscored. Round-robin by format instead.
 */
export function balancedSubset(candidates: Candidate[], max: number): Candidate[] {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.format) ?? [];
    group.push(candidate);
    groups.set(candidate.format, group);
  }
  const out: Candidate[] = [];
  for (let round = 0; out.length < max; round++) {
    let added = false;
    for (const group of groups.values()) {
      const candidate = group[round];
      if (!candidate) continue;
      out.push(candidate);
      added = true;
      if (out.length >= max) break;
    }
    if (!added) break;
  }
  return out;
}

/**
 * Build one `/v1/systemone` request for a topic and its shortlist: one Noul
 * per candidate, all evaluated against the same state. This is the Jev-style
 * re-ranking pattern, and Ollama's decision models speak the same API.
 */
export function buildSystemOneRequest(
  topic: string,
  candidates: Candidate[],
  model: string,
): BuiltSystemOneRequest {
  const idToCandidate = new Map<string, Candidate>();
  const items: SystemOneCandidate[] = [];
  const questions: Record<string, SystemOneQuestion> = {};

  balancedSubset(candidates, MAX_DECISION_CANDIDATES).forEach((candidate, index) => {
    const id = `c${index}`;
    idToCandidate.set(id, candidate);
    items.push({
      id,
      title: candidate.title.slice(0, MAX_TITLE_CHARS),
      venue: candidate.venue?.slice(0, 80),
      description: candidate.description?.slice(0, MAX_DESCRIPTION_CHARS),
    });
    questions[id] = {
      type: 'noul',
      instructions:
        `Is \`candidates[${index}]\` a resource a lecturer would plausibly ` +
        `use when teaching \`topic\`?`,
      criteria: {
        true: 'Directly relevant to the topic; a lecturer could reasonably assign or recommend it.',
        false: 'Only tangentially related, off-topic, or not useful for teaching this topic.',
      },
    };
  });

  return {
    request: {
      model,
      state: { topic, candidates: items },
      questions,
      keep_alive: '5m',
    },
    idToCandidate,
  };
}

/** Pull the Noul probabilities back out, keyed by the original candidates. */
export function parseSystemOneScores(
  response: unknown,
  idToCandidate: Map<string, Candidate>,
): Map<Candidate, number> {
  const answers =
    (response as { answers?: Record<string, { type?: string; noul?: number }> })
      ?.answers ?? {};
  const scores = new Map<Candidate, number>();
  for (const [id, answer] of Object.entries(answers)) {
    const candidate = idToCandidate.get(id);
    if (candidate && typeof answer?.noul === 'number') {
      scores.set(candidate, answer.noul);
    }
  }
  return scores;
}

/**
 * Local System One reranker (ADR-0016). Ollama >= 0.35 exposes the
 * Jev-compatible `/v1/systemone` endpoint for decision models such as
 * `tev1:4b`, `nimble` and `clef`. No API key, no network, no per-token bill.
 */
export class OllamaDecisionReranker implements Reranker {
  readonly name = 'ollama-systemone';

  constructor(
    private readonly baseUrl: string,
    private readonly model: string = 'tev1:4b',
    private readonly apiKey?: string,
  ) {}

  async score(topic: string, candidates: Candidate[]): Promise<Map<Candidate, number>> {
    if (!candidates.length) return new Map();
    const { request, idToCandidate } = buildSystemOneRequest(topic, candidates, this.model);
    if (!Object.keys(request.questions).length) return new Map();

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/systemone`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Ollama System One HTTP ${res.status}`);
    return parseSystemOneScores(await res.json(), idToCandidate);
  }
}
