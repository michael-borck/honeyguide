import type { PipelineConfig } from '../config.js';

/**
 * One place for the Ollama `/api/generate` call. Four modules (query
 * derivation, counterpoint queries, rationale, alignment reasons) previously
 * each rebuilt the same request; they now share this helper, which applies the
 * bearer auth, the low-temperature defaults and a hard timeout consistently.
 */

export const DEFAULT_OLLAMA_MODEL = 'llama3.1:8b';

export interface OllamaGenerateOptions {
  model?: string;
  /** Hard cap on generated tokens. */
  numPredict?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Abort signal (e.g. client disconnect). */
  signal?: AbortSignal;
}

export async function ollamaGenerate(
  config: PipelineConfig,
  prompt: string,
  options: OllamaGenerateOptions = {},
): Promise<string> {
  if (!config.ollamaUrl) throw new Error('no Ollama configured');
  const res = await fetch(`${config.ollamaUrl.replace(/\/$/, '')}/api/generate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.ollamaApiKey ? { authorization: `Bearer ${config.ollamaApiKey}` } : {}),
    },
    body: JSON.stringify({
      model: options.model ?? config.ollamaModel ?? DEFAULT_OLLAMA_MODEL,
      prompt,
      stream: false,
      think: false,
      options: {
        num_predict: options.numPredict ?? 120,
        temperature: options.temperature ?? 0.3,
      },
    }),
    signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = (await res.json()) as { response?: string };
  const text = data.response?.trim();
  if (!text) throw new Error('empty Ollama response');
  return text;
}