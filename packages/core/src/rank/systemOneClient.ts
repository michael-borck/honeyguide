/**
 * Shared client for the Jev-compatible `/v1/systemone` endpoint used by local
 * decision models (ADR-0016). Both the re-ranker and the outcome aligner POST
 * a request here; centralising the transport keeps auth and timeouts
 * consistent and leaves room for a future non-Ollama backend.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

export async function postSystemOne(
  baseUrl: string,
  request: unknown,
  options: { apiKey?: string; timeoutMs?: number } = {},
): Promise<unknown> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/systemone`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Ollama System One HTTP ${res.status}`);
  return res.json();
}