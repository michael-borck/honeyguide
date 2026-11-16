import type { Candidate } from '../retrieval/candidates.js';
import type { PipelineConfig } from '../config.js';
import { ollamaGenerate } from './ollamaClient.js';

const GENERATE_TIMEOUT_MS = 30_000;

/** The rationale prompt, including optional teaching context (ADR-0018). */
export function buildRationalePrompt(
  topic: string,
  candidate: Candidate,
  stance: 'supporting' | 'counterpoint' = 'supporting',
  context?: string,
): string {
  const meta = [
    `Title: ${candidate.title}`,
    candidate.authors.length ? `By: ${candidate.authors.slice(0, 3).join(', ')}` : null,
    candidate.year ? `Year: ${candidate.year}` : null,
    `Type: ${candidate.format}`,
    candidate.description ? `Description: ${candidate.description.slice(0, 400)}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const ask =
    stance === 'counterpoint'
      ? `In one or two sentences, say how this resource challenges, ` +
        `complicates or disagrees with the usual framing of that topic, ` +
        `and why showing students a counterpoint here could be valuable.`
      : `In one or two sentences, say why this resource could support that teaching, ` +
        `what it adds, and (if apparent) what it does not cover.`;
  return (
    (context ? `Teaching context: ${context.slice(0, 400)}\n\n` : '') +
    `A lecturer is teaching: "${topic.slice(0, 300)}"\n\n` +
    `Candidate ${stance === 'counterpoint' ? 'counterpoint' : 'supporting'} resource:\n${meta}\n\n` +
    `${ask} ` +
    `Be concrete and honest; do not invent details not present above. ` +
    `Reply with the sentences only.`
  );
}

/**
 * Generate a one-to-two sentence relational rationale (ADR-0011 rung 1).
 * Prompt is sized for 4B–8B models (spec §8): short, concrete, no format
 * tricks. The LLM only writes ABOUT a resource retrieval already found —
 * it can never introduce one.
 */
export async function generateRationale(
  topic: string,
  candidate: Candidate,
  config: PipelineConfig,
  stance: 'supporting' | 'counterpoint' = 'supporting',
  context?: string,
): Promise<string> {
  if (!config.ollamaUrl) throw new Error('no Ollama configured');
  const prompt = buildRationalePrompt(topic, candidate, stance, context);

  const text = await ollamaGenerate(config, prompt, {
    numPredict: 120,
    temperature: 0.3,
    timeoutMs: GENERATE_TIMEOUT_MS,
  });
  return text;
}
