import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configFromEnv } from '@michaelborck/honeyguide-core';
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
  run: (job, cfg, byok) => runner.run(job, cfg, byok),
  queueAvailable: runner.available,
  webDistPath,
  version: packageVersion(),
  // Default on for self-hosters; the hosted free tier sets
  // HONEYGUIDE_ALLOW_BATCH=0 (spec §9: batch is a tier feature).
  allowBatch: process.env.HONEYGUIDE_ALLOW_BATCH !== '0',
});

app.listen(config.port, () => {
  console.log(`honeyguide server listening on :${config.port}`);
});
