import type {
  Alignment,
  AlignmentConfidence,
  Outcome,
  Resource,
} from '../types.js';
import type { PipelineConfig } from '../config.js';
import { createEmbeddingProvider, type EmbeddingProvider } from '../rank/embeddings.js';
import { cosineSimilarity } from '../rank/semantic.js';

const TIMEOUT_MS = 30_000;
export const MAX_ALIGN_RESOURCES = 12;
export const MAX_ALIGN_OUTCOMES = 8;
const MAX_TEXT_CHARS = 240;
const EMBEDDING_MIN_SCORE = 0.35;

const OUTCOMES_HEADING =
  /^(?:(?:learning|intended|course|unit|subject|module|program|programme|graduate)\s+)*outcomes?$|^(?:ilos?|clos?|ulos?|slos?)$/i;
const OTHER_HEADING =
  /^(?:week|module|topic|unit|lecture|seminar|workshop|assessment|assessments|resources|readings?|activities|schedule|content|description|overview|introduction)\b/i;

/**
 * Extract outcomes from a plain list or a pasted unit outline. When an
 * "Outcomes" heading is present, only that section is used; otherwise every
 * non-structural line is a candidate. List markers, numbering and outcome
 * codes (LO1, CLO2…) are stripped.
 */
export function parseOutcomes(text: string): Outcome[] {
  const lines = text.split(/\r?\n/);
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (OUTCOMES_HEADING.test(heading(lines[i]))) {
      start = i + 1;
      break;
    }
  }
  const hasOutcomesHeading = start > 0;
  const seen = new Set<string>();
  const texts: string[] = [];

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const clean = heading(line);
    if (OUTCOMES_HEADING.test(clean)) continue;
    if (OTHER_HEADING.test(clean)) {
      if (hasOutcomesHeading) break;
      continue;
    }
    const outcome = stripPrefix(line);
    if (outcome.length < 8) continue;
    const key = outcome.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    texts.push(outcome);
  }

  return texts.map((outcomeText, index) => ({ id: `o${index}`, text: outcomeText }));
}

/** A line reduced to its section-heading text, or '' if it is not a heading. */
function heading(line: string): string {
  return line
    .replace(/^[#*\s]+/, '')
    .replace(/[*\s]+$/, '')
    .replace(/:$/, '')
    .trim();
}

function stripPrefix(line: string): string {
  return line
    .replace(/^\s*(?:[-*•·▪]|\d+(?:\.\d+)*[.)]?)\s*/, '')
    .replace(/^(?:LO|ILO|CLO|ULO|SLO)\s*\d+\s*[:.)-]?\s*/i, '')
    .replace(/^students?\s+(?:will|should)\s+be\s+able\s+to\s+/i, '')
    .replace(/^students?\s+can\s+/i, '')
    .replace(/^be\s+able\s+to\s+/i, '')
    .trim();
}

export interface AlignmentQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export interface AlignmentRequest {
  model: string;
  state: {
    topic: string;
    outcomes: Array<{ id: string; text: string }>;
    resources: Array<{
      id: string;
      title: string;
      venue?: string;
      description?: string;
    }>;
  };
  questions: Record<string, AlignmentQuestion>;
  keep_alive: string;
}

export interface BuiltAlignmentRequest {
  request: AlignmentRequest;
  resourceById: Map<string, Resource>;
  outcomeById: Map<string, Outcome>;
}

/**
 * Build one `/v1/systemone` request: a Choice per resource over the outcome
 * list plus `none`. Choice probabilities let us keep near-ties instead of
 * blindly trusting a `none` that won by a rounding error.
 */
export function buildAlignmentRequest(
  topic: string,
  resources: Resource[],
  outcomes: Outcome[],
  model: string,
): BuiltAlignmentRequest {
  const outcomeList = outcomes.slice(0, MAX_ALIGN_OUTCOMES);
  const resourceList = resources.slice(0, MAX_ALIGN_RESOURCES);
  const resourceById = new Map<string, Resource>();
  const outcomeById = new Map<string, Outcome>();

  const criteria: Record<string, string> = {};
  for (const outcome of outcomeList) {
    outcomeById.set(outcome.id, outcome);
    criteria[outcome.id] = outcome.text.slice(0, MAX_TEXT_CHARS);
  }
  criteria.none = 'None of the outcomes fit this resource.';

  const questions: Record<string, AlignmentQuestion> = {};
  const stateResources: AlignmentRequest['state']['resources'] = [];
  resourceList.forEach((resource, index) => {
    const id = `r${index}`;
    resourceById.set(id, resource);
    stateResources.push({
      id,
      title: resource.title.slice(0, 180),
      venue: resource.venue?.slice(0, 80),
      description: resource.annotation.text?.slice(0, MAX_TEXT_CHARS),
    });
    questions[id] = {
      type: 'choice',
      instructions:
        `Which \`outcomes\` entry does \`resources[${index}]\` best help a ` +
        `lecturer teach? Choose \`none\` if no outcome fits.`,
      criteria,
    };
  });

  return {
    request: {
      model,
      state: {
        topic: topic.slice(0, 300),
        outcomes: outcomeList.map((outcome) => ({
          id: outcome.id,
          text: outcome.text.slice(0, MAX_TEXT_CHARS),
        })),
        resources: stateResources,
      },
      questions,
      keep_alive: '5m',
    },
    resourceById,
    outcomeById,
  };
}

export function parseAlignmentResponse(
  response: unknown,
  resourceById: Map<string, Resource>,
  outcomeById: Map<string, Outcome>,
): Map<Resource, Alignment> {
  const answers =
    (response as {
      answers?: Record<
        string,
        {
          type?: string;
          choice?: string;
          confidence?: number;
          probabilities?: Record<string, number>;
        }
      >;
    })?.answers ?? {};

  const result = new Map<Resource, Alignment>();
  for (const [resourceId, resource] of resourceById) {
    const answer = answers[resourceId];
    if (!answer || answer.type !== 'choice') continue;
    const probabilities = answer.probabilities ?? {};
    const noneProbability = probabilities.none ?? 0;
    let chosen = answer.choice ?? 'none';
    let forcedLow = false;

    if (chosen === 'none') {
      const best = [...outcomeById.keys()]
        .map((id) => ({ id, probability: probabilities[id] ?? 0 }))
        .sort((a, b) => b.probability - a.probability)[0];
      // The small decision model sometimes puts `none` a hair ahead of a
      // genuinely close outcome. Keep it as a low-confidence proposal.
      if (best && best.probability >= 0.35 && best.probability >= noneProbability * 0.8) {
        chosen = best.id;
        forcedLow = true;
      } else {
        continue;
      }
    }

    const outcome = outcomeById.get(chosen);
    if (!outcome) continue;
    const score = probabilities[chosen] ?? answer.confidence ?? 0;
    result.set(resource, {
      outcomeId: outcome.id,
      outcomeText: outcome.text,
      score,
      confidence: forcedLow ? 'low' : confidenceBand(score),
      proposedBy: 'decision',
      confirmed: false,
    });
  }
  return result;
}

export interface OutcomeAligner {
  readonly name: 'decision' | 'embeddings';
  align(
    topic: string,
    resources: Resource[],
    outcomes: Outcome[],
  ): Promise<Map<Resource, Alignment>>;
}

/**
 * Local System One alignment (ADR-0017): one Choice per resource. Preferred
 * because it reasons about fit rather than surface similarity.
 */
export class OllamaOutcomeAligner implements OutcomeAligner {
  readonly name = 'decision';

  constructor(
    private readonly baseUrl: string,
    private readonly model: string = 'tev1:0.8b',
    private readonly apiKey?: string,
  ) {}

  async align(
    topic: string,
    resources: Resource[],
    outcomes: Outcome[],
  ): Promise<Map<Resource, Alignment>> {
    const { request, resourceById, outcomeById } = buildAlignmentRequest(
      topic,
      resources,
      outcomes,
      this.model,
    );
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
    return parseAlignmentResponse(await res.json(), resourceById, outcomeById);
  }
}

/**
 * Embedding fallback: cosine similarity between each resource and outcome.
 * Less precise than a Choice, but works anywhere embeddings do.
 */
export class EmbeddingOutcomeAligner implements OutcomeAligner {
  readonly name = 'embeddings';

  constructor(private readonly provider: EmbeddingProvider) {}

  async align(
    _topic: string,
    resources: Resource[],
    outcomes: Outcome[],
  ): Promise<Map<Resource, Alignment>> {
    const outcomeList = outcomes.slice(0, MAX_ALIGN_OUTCOMES);
    const resourceList = resources.slice(0, MAX_ALIGN_RESOURCES);
    if (!outcomeList.length || !resourceList.length) return new Map();

    const texts = [
      ...outcomeList.map((outcome) => outcome.text),
      ...resourceList.map(resourceText),
    ];
    const vectors = await this.provider.embed(texts);
    if (vectors.length !== texts.length) {
      throw new Error('embedding count did not match the request');
    }
    const outcomeVectors = vectors.slice(0, outcomeList.length);
    const resourceVectors = vectors.slice(outcomeList.length);

    const result = new Map<Resource, Alignment>();
    resourceList.forEach((resource, resourceIndex) => {
      let bestOutcome: Outcome | null = null;
      let bestScore = -1;
      for (let outcomeIndex = 0; outcomeIndex < outcomeList.length; outcomeIndex++) {
        const score = cosineSimilarity(
          resourceVectors[resourceIndex],
          outcomeVectors[outcomeIndex],
        );
        if (score > bestScore) {
          bestScore = score;
          bestOutcome = outcomeList[outcomeIndex];
        }
      }
      if (bestOutcome && bestScore >= EMBEDDING_MIN_SCORE) {
        result.set(resource, {
          outcomeId: bestOutcome.id,
          outcomeText: bestOutcome.text,
          score: bestScore,
          confidence: confidenceBand(bestScore),
          proposedBy: 'embeddings',
          confirmed: false,
        });
      }
    });
    return result;
  }
}

/** Pick the configured aligner: decision model first, embeddings second. */
export function createOutcomeAligner(config: PipelineConfig): OutcomeAligner | null {
  if (config.decisionUrl) {
    return new OllamaOutcomeAligner(
      config.decisionUrl,
      config.decisionModel ?? 'tev1:0.8b',
      config.decisionApiKey,
    );
  }
  if (config.embeddingUrl) {
    const provider = createEmbeddingProvider(config);
    return provider ? new EmbeddingOutcomeAligner(provider) : null;
  }
  return null;
}

function resourceText(resource: Resource): string {
  return [resource.title, resource.venue, resource.annotation.text]
    .filter(Boolean)
    .join('. ')
    .slice(0, 400);
}

function confidenceBand(score: number): AlignmentConfidence {
  if (score >= 0.7) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}
