import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

/**
 * Server integration tests: spin up the real Express app on an ephemeral port
 * and drive it over HTTP, so the security middleware, routing and response
 * shapes are exercised end-to-end (previously the server had no tests).
 *
 * `run`/`runStream` are stubbed — these tests are about the HTTP contract, not
 * the retrieval pipeline (which has its own unit tests in core).
 */

function makeApp(overrides = {}) {
  return createApp({
    pipelineDefaults: {},
    run: async (job) => ({
      resources: [],
      componentHealth: { papers: 'ok' },
      echo: job.input,
    }),
    runStream: async (job, _config, onProgress) => {
      onProgress?.({ stage: 'done' });
      return { resources: [], componentHealth: {}, echo: job.input };
    },
    queueAvailable: false,
    webDistPath: '/nonexistent-web-dist',
    version: '0.0.0-test',
    allowBatch: false,
    ...overrides,
  });
}

async function withServer(overrides, fn) {
  const app = makeApp(overrides);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (base, path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('GET /api/health reports status, version and capabilities', async () => {
  await withServer({ allowBatch: true }, async (base) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.version, '0.0.0-test');
    assert.equal(body.capabilities.batch, true);
    assert.equal(body.capabilities.streaming, true);
    assert.ok(body.sources.papers.length > 0);
  });
});

test('security headers are set (CSP, nosniff, frame options)', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/health`);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp ?? '', /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('x-frame-options'));
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

test('POST /api/suggest requires input', async () => {
  await withServer({}, async (base) => {
    const res = await post(base, '/api/suggest', {});
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /input is required/);
  });
});

test('POST /api/suggest rejects a private BYO provider URL (SSRF)', async () => {
  await withServer({ allowPrivateTargets: false }, async (base) => {
    const res = await post(base, '/api/suggest', {
      input: 'test',
      provider: { url: 'http://127.0.0.1:11434' },
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /private or invalid provider URL/);
  });
});

test('POST /api/suggest returns JSON by default and markdown on request', async () => {
  await withServer({}, async (base) => {
    const json = await post(base, '/api/suggest', { input: 'supply chain' });
    assert.equal(json.status, 200);
    assert.deepEqual((await json.json()).resources, []);

    const md = await post(base, '/api/suggest', { input: 'supply chain', format: 'markdown' });
    assert.equal(md.status, 200);
    assert.match(md.headers.get('content-type') ?? '', /text\/markdown/);
    assert.match(await md.text(), /Supporting resources: supply chain/);
  });
});

test('POST /api/suggest/stream emits SSE progress and a result event', async () => {
  await withServer({}, async (base) => {
    const res = await post(base, '/api/suggest/stream', { input: 'forecasting' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const text = await res.text();
    assert.match(text, /event: progress/);
    assert.match(text, /event: result/);
  });
});

test('POST /api/batch is forbidden unless the tier allows it', async () => {
  await withServer({ allowBatch: false }, async (base) => {
    const res = await post(base, '/api/batch', { topics: ['a'] });
    assert.equal(res.status, 403);
  });
});

test('POST /api/export validates input and format', async () => {
  await withServer({}, async (base) => {
    const missing = await post(base, '/api/export', { format: 'markdown' });
    assert.equal(missing.status, 400);

    const badFormat = await post(base, '/api/export', {
      result: { resources: [], componentHealth: {} },
      format: 'xml',
    });
    assert.equal(badFormat.status, 400);

    const ok = await post(base, '/api/export', {
      topic: 'x',
      result: { resources: [], componentHealth: {} },
      format: 'markdown',
    });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type') ?? '', /text\/markdown/);
  });
});

test('POST /api/recheck blocks a private URL instead of fetching it (SSRF)', async () => {
  await withServer({ allowPrivateTargets: false }, async (base) => {
    const res = await post(base, '/api/recheck', {
      resources: [
        {
          title: 'metadata',
          url: 'http://169.254.169.254/latest/meta-data',
          verification: 'unverified',
          verificationBasis: 'none',
        },
      ],
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.entries[0].current, 'blocked');
  });
});

test('POST /api/recheck rejects an empty resource list', async () => {
  await withServer({}, async (base) => {
    const res = await post(base, '/api/recheck', { resources: [] });
    assert.equal(res.status, 400);
  });
});

test('rate limiting returns 429 once the per-IP cap is exceeded', async () => {
  await withServer({ rateLimit: { windowMs: 60_000, max: 2 } }, async (base) => {
    const first = await post(base, '/api/suggest', {});
    const second = await post(base, '/api/suggest', {});
    const third = await post(base, '/api/suggest', {});
    assert.equal(first.status, 400);
    assert.equal(second.status, 400);
    assert.equal(third.status, 429);
  });
});