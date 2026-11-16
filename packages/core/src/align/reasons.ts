import type { Resource } from '../types.js';
import type { PipelineConfig } from '../config.js';
import { ollamaGenerate } from '../annotate/ollamaClient.js';
import { mapLimit } from '../util.js';

const TIMEOUT_MS = 12_000;
// Alignment is capped at 12 resources; generating reasons for all of them
// with a local LLM is slow, so only the first few proposals get prose.
const MAX_REASONS = 6;
const REASON_CONCURRENCY = 3;

/** The prompt for a one-line "why this outcome" reason. */
export function buildAlignmentReasonPrompt(
  topic: string,
  outcomeText: string,
  resource: Resource,
): string {
  const meta = [
    resource.title,
    resource.venue ? `Venue: ${resource.venue}` : null,
    resource.year ? `Year: ${resource.year}` : null,
    resource.annotation.text
      ? `Description: ${resource.annotation.text.slice(0, 400)}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    `A lecturer is teaching: "${topic.slice(0, 300)}"\n\n` +
    `Unit outcome: "${outcomeText.slice(0, 300)}"\n\n` +
    `Resource:\n${meta}\n\n` +
    `In one short sentence, say specifically how this resource helps students ` +
    `meet that outcome. Do not invent details not present above. ` +
    `Reply with the sentence only.`
  );
}

export async function generateAlignmentReason(
  topic: string,
  outcomeText: string,
  resource: Resource,
  config: PipelineConfig,
): Promise<string | undefined> {
  if (!config.ollamaUrl) return undefined;
  const response = await ollamaGenerate(
    config,
    buildAlignmentReasonPrompt(topic, outcomeText, resource),
    { numPredict: 80, temperature: 0.2, timeoutMs: TIMEOUT_MS },
  );
  const line = response.split('\n')[0]?.trim();
  return line ? line.slice(0, 240) : undefined;
}

/**
 * Fill in `alignment.reason` for up to a few resources with the local LLM.
 * Optional and non-fatal: no LLM, a timeout or a bad response simply leaves
 * the reason absent.
 */
export async function addAlignmentReasons(
  resources: Resource[],
  topic: string,
  config: PipelineConfig,
): Promise<void> {
  if (!config.ollamaUrl || config.alignmentReasons === false) return;
  const targets = resources.filter((resource) => resource.alignment).slice(0, MAX_REASONS);
  if (!targets.length) return;

  await mapLimit(targets, REASON_CONCURRENCY, async (resource) => {
    const alignment = resource.alignment!;
    try {
      const reason = await generateAlignmentReason(
        topic,
        alignment.outcomeText,
        resource,
        config,
      );
      if (reason) alignment.reason = reason;
    } catch {
      // reasons are a bonus, never a failure
    }
  });
}
