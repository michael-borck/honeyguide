import type { ProgressEvent, Resource, SuggestResult } from '@michaelborck/honeyguide-core/web';

export interface Health {
  version?: string;
  components?: Record<string, string>;
  capabilities?: Record<string, boolean>;
  sources?: Record<string, string | string[]>;
  limits?: {
    requests?: { windowMs: number; max: number } | null;
    search?: { windowMs: number; max: number } | null;
  };
}

export interface OllamaDetection {
  available: boolean;
  url?: string;
  models?: string[];
  chatModels?: string[];
  decisionModels?: string[];
  embeddingModels?: string[];
}

export interface RecheckEntry {
  resource: Resource;
  previous: string;
  current: string;
  changed: boolean;
}

export interface ExtractedDoc {
  fileName: string;
  text: string;
}

export type SuggestPayload = Record<string, unknown>;

async function errorFrom(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `HTTP ${res.status}`;
}

export async function getHealth(): Promise<Health> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function detectOllama(): Promise<OllamaDetection> {
  const res = await fetch('/api/detect-ollama');
  return res.json();
}

export async function extractDocument(file: File): Promise<ExtractedDoc> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/extract', { method: 'POST', body: form });
  if (!res.ok) throw new Error(await errorFrom(res));
  return res.json();
}

export async function postSuggest(
  payload: SuggestPayload,
  format?: string,
): Promise<Response> {
  const res = await fetch('/api/suggest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, ...(format ? { format } : {}) }),
  });
  if (!res.ok) throw new Error(await errorFrom(res));
  return res;
}

export async function postBatch(
  payload: SuggestPayload,
  format?: string,
): Promise<Response> {
  const res = await fetch('/api/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, ...(format ? { format } : {}) }),
  });
  if (!res.ok) throw new Error(await errorFrom(res));
  return res;
}

export async function postExport(
  payload: { topic: string; result: SuggestResult; format: string },
): Promise<Response> {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errorFrom(res));
  return res;
}

export async function postRecheck(resources: Resource[]): Promise<RecheckEntry[]> {
  const res = await fetch('/api/recheck', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ resources }),
  });
  if (!res.ok) throw new Error(await errorFrom(res));
  const data = (await res.json()) as { entries: RecheckEntry[] };
  return data.entries;
}

/**
 * POST /api/suggest/stream and consume the SSE body. Returns the final result
 * and streams progress via `onProgress`. Throws if the server reports an error
 * event or the stream ends without a result.
 */
export async function streamSuggest(
  payload: SuggestPayload,
  onProgress: (event: ProgressEvent) => void,
): Promise<SuggestResult> {
  const res = await fetch('/api/suggest/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: SuggestResult | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = 'message';
      let data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) {
        const parsed = JSON.parse(data) as
          | ProgressEvent
          | SuggestResult
          | { error?: string };
        if (event === 'progress') {
          onProgress(parsed as ProgressEvent);
        } else if (event === 'result') {
          result = parsed as SuggestResult;
        } else if (event === 'error') {
          throw new Error((parsed as { error?: string }).error ?? 'Streaming failed');
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }

  if (!result) throw new Error('Streaming returned no result');
  return result;
}