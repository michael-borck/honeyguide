import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { configFromEnv, suggestResources } from '@michaelborck/honeyguide-core';
import { loadConfig } from './config.js';
import { createRunner } from './queue.js';
import { createApp } from './app.js';

const config = loadConfig();
const pipelineDefaults = configFromEnv();
const runner = await createRunner(
  config.redisUrl,
  pipelineDefaults,
  Number(process.env.SUGGEST_CONCURRENCY ?? 2),
);

// In the Docker image the built web UI is copied alongside the server.
const webDistPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public',
);

/** Read the server package's version at runtime — `npm_package_version` is
 *  absent when the container runs `node` directly, which reported 0.0.0. */
function packageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const app = createApp({
  pipelineDefaults,
  run: (job, cfg, byok, onProgress) => runner.run(job, cfg, byok, onProgress),
  runStream:
    !runner.available || process.env.HONEYGUIDE_ALLOW_STREAM === '1'
      ? (job, cfg, onProgress) => suggestResources(job, cfg, onProgress)
      : undefined,
  queueAvailable: runner.available,
  webDistPath,
  version: packageVersion(),
  // Default on for self-hosters; the hosted free tier sets
  // HONEYGUIDE_ALLOW_BATCH=0 (spec §9: batch is a tier feature).
  allowBatch: process.env.HONEYGUIDE_ALLOW_BATCH !== '0',
});

const server: Server = app.listen(config.port, () => {
  console.log(`honeyguide server listening on :${config.port}`);
});

// Never wait on a stuck socket; the queue cap protects the box.
server.requestTimeout = Number(process.env.HONEYGUIDE_REQUEST_TIMEOUT_MS ?? 360_000);
server.headersTimeout = 20_000;

/** Graceful shutdown: stop accepting, drain the queue, then exit. */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[honeyguide] ${signal} received, shutting down`);
  await Promise.allSettled([
    new Promise<void>((resolve) => server.close(() => resolve())),
    runner.close(),
  ]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));