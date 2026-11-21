import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import {
  toMarkdown,
  toCitations,
  toLmsHtml,
  extract,
  recheckResources,
  createSearchProvider,
  clamp,
  assertPublicUrl,
  type Outcome,
  type PipelineConfig,
  type ProgressListener,
  type SearchConstraints,
  type SuggestResult,
} from '@michaelborck/honeyguide-core';

/**
 * The HTTP app, embeddable: the hosted server (index.ts) mounts it behind
 * the BullMQ runner, and the Electron desktop shell mounts the same app
 * with an inline runner. One contract, two homes (ADR-0001).
 */
export interface AppOptions {
  pipelineDefaults: PipelineConfig;
  run: (
    job: {
      input: string;
      maxResults: number;
      counterpoint?: boolean;
      outcomes?: Outcome[];
      constraints?: SearchConstraints;
      context?: string;
    },
    config: PipelineConfig,
    byok: boolean,
    onProgress?: ProgressListener,
  ) => Promise<SuggestResult>;
  /** Inline streaming runner (no queue); enables `/api/suggest/stream`. */
  runStream?: (
    job: {
      input: string;
      maxResults: number;
      counterpoint?: boolean;
      outcomes?: Outcome[];
      constraints?: SearchConstraints;
      context?: string;
    },
    config: PipelineConfig,
    onProgress: ProgressListener,
  ) => Promise<SuggestResult>;
  queueAvailable: boolean;
  webDistPath: string;
  version?: string;
  /** Batch is a self-host/desktop tier capability (spec §9). */
  allowBatch?: boolean;
  /** Screenshot engine, injected by tiers that have one (ADR-0005 layer 3). */
  screenshot?: (url: string) => Promise<string | undefined>;
  /**
   * Permit server-side fetches to private/reserved addresses. The hosted
   * server leaves this false so client-supplied URLs (provider endpoints,
   * web results, rechecks) cannot reach internal networks (SSRF); the
   * desktop app sets it true because it is a single-user localhost service.
   */
  allowPrivateTargets?: boolean;
  /**
   * Per-IP request cap for `/api`. Pass `false` to disable (desktop). Defaults
   * to 120 requests/minute when omitted.
   */
  rateLimit?: false | { windowMs: number; max: number };
  /**
   * Per-IP cap on requests that use this server's own web-search provider.
   * Requests that bring their own Brave/Serper/SearXNG credentials skip it.
   * Defaults to 20/minute when the server has a search provider configured.
   * Pass `false` to disable (desktop).
   */
  searchLimit?: false | { windowMs: number; max: number };
}

interface SuggestBody {
  input?: string;
  maxResults?: number;
  format?: 'json' | 'markdown' | 'html' | 'apa' | 'harvard';
  /**
   * Per-request BYO credentials (ADR-0004): held in memory for the life
   * of this call only — never logged, never queued, never persisted.
   * Any BYO credential routes the request around the queue, because job
   * payloads land in Redis.
   */
  provider?: { url?: string; apiKey?: string; model?: string };
  youtubeApiKey?: string;
  /** Per-request web-search credentials and fallback preference. */
  braveApiKey?: string;
  serperApiKey?: string;
  searxngUrl?: string;
  searchFallbackEnabled?: boolean;
  searchFallbackOrder?: string;
  /** Optional per-request local embeddings for semantic re-ranking (ADR-0015). */
  embeddings?: { url?: string; model?: string };
  /** Optional per-request local System One decision model (ADR-0016). */
  decision?: { url?: string; model?: string };
  /** Explicit re-ranking choice; `off` overrides a server .env re-ranker. */
  rerank?: 'off' | 'auto' | 'decision' | 'embeddings';
  /** Optional unit outcomes; when present the pipeline proposes alignments. */
  outcomes?: Outcome[];
  /** Interview brief constraints and teaching context (ADR-0018). */
  constraints?: SearchConstraints;
  context?: string;
  counterpoint?: boolean;
}

/** A client error whose message is safe to return to the caller. */
class BadRequest extends Error {}

interface WindowQuotaResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/** Small fixed-window quota. Kept in-process; the hosted tier is single-node. */
function createWindowQuota(windowMs: number, max: number) {
  const entries = new Map<string, { count: number; resetAt: number }>();
  return {
    consume(key: string, cost = 1): WindowQuotaResult {
      const now = Date.now();
      let entry = entries.get(key);
      if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + windowMs };
        entries.set(key, entry);
      }
      if (entry.count + cost > max) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.max(0, entry.resetAt - now),
        };
      }
      entry.count += cost;
      if (entries.size > 5000) {
        for (const [keyName, value] of entries) {
          if (value.resetAt <= now) entries.delete(keyName);
        }
      }
      return {
        allowed: true,
        remaining: Math.max(0, max - entry.count),
        retryAfterMs: 0,
      };
    },
  };
}

export function createApp(options: AppOptions): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Correct client IPs behind a reverse proxy (hosted VPS). Set
  // HONEYGUIDE_TRUST_PROXY=0 when the server is exposed directly, so clients
  // cannot spoof X-Forwarded-For to dodge the rate limiter.
  app.set('trust proxy', Number(process.env.HONEYGUIDE_TRUST_PROXY ?? 1));
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          // 'unsafe-inline' is required by the theme-bootstrap script in
          // index.html; all other scripts are same-origin bundles.
          'script-src': ["'self'", "'unsafe-inline'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'https:'],
          'connect-src': ["'self'"],
          'font-src': ["'self'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
        },
      },
      // Thumbnails are cross-origin https images without CORP headers; COEP
      // would block them.
      crossOriginEmbedderPolicy: false,
    }),
  );

  const defaultMax = Number(process.env.HONEYGUIDE_RATE_LIMIT ?? 120);
  const rateLimitConfig =
    options.rateLimit === false
      ? null
      : (options.rateLimit ?? {
          windowMs: 60_000,
          max: Number.isFinite(defaultMax) ? defaultMax : 120,
        });
  if (rateLimitConfig) {
    const limiter = rateLimit({
      windowMs: rateLimitConfig.windowMs,
      limit: rateLimitConfig.max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      // Health checks from Docker/orchestrators should never be throttled.
      skip: (req) => req.path === '/health',
    });
    app.use('/api', limiter);
  }

  // JSON bodies are topics/outcomes/extracted text (the extractor caps at
  // 200k chars), so 2 MB is ample; a smaller cap shrinks the memory DoS surface.
  app.use(express.json({ limit: '2mb' }));

  const defaultSearchMax = Number(process.env.HONEYGUIDE_SEARCH_LIMIT ?? 20);
  const defaultSearchWindow = Number(
    process.env.HONEYGUIDE_SEARCH_LIMIT_WINDOW_MS ?? 60_000,
  );
  const hasServerSearch = Boolean(
    options.pipelineDefaults.searxngUrl ||
      options.pipelineDefaults.braveApiKey ||
      options.pipelineDefaults.serperApiKey,
  );
  const searchLimitConfig =
    options.searchLimit === false
      ? null
      : (options.searchLimit ??
        (hasServerSearch
          ? {
              windowMs: Number.isFinite(defaultSearchWindow)
                ? defaultSearchWindow
                : 60_000,
              max: Number.isFinite(defaultSearchMax) ? defaultSearchMax : 20,
            }
          : null));
  const searchQuota = searchLimitConfig
    ? createWindowQuota(searchLimitConfig.windowMs, searchLimitConfig.max)
    : null;

  function isByokSearch(body: SuggestBody | undefined): boolean {
    return Boolean(body?.braveApiKey || body?.serperApiKey || body?.searxngUrl);
  }

  function enforceSearchQuota(
    req: express.Request,
    res: express.Response,
    cost = 1,
  ): boolean {
    if (!searchQuota) return true;
    if (isByokSearch(req.body as SuggestBody | undefined)) return true;
    const result = searchQuota.consume(req.ip ?? 'unknown', Math.max(1, cost));
    if (result.allowed) return true;
    const retryAfter = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: `Search limit reached. Try again in ${retryAfter} seconds.`,
      retryAfterSeconds: retryAfter,
    });
    return false;
  }

  if (searchLimitConfig) {
    app.use(['/api/suggest', '/api/suggest/stream'], (req, res, next) => {
      if (enforceSearchQuota(req, res, 1)) next();
    });
    app.use('/api/batch', (req, res, next) => {
      const body = req.body as { topics?: unknown } | undefined;
      const cost = Array.isArray(body?.topics) ? Math.max(1, body.topics.length) : 1;
      if (enforceSearchQuota(req, res, cost)) next();
    });
  }

  /** Log the real error server-side; never leak internals to the client. */
  function fail(res: express.Response, error: unknown): void {
    if (error instanceof BadRequest) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('[honeyguide] request failed:', error instanceof Error ? error : error);
    res.status(500).json({ error: 'Internal server error' });
  }

  // Component health is surfaced to the UI per ADR-0006.
  app.get('/api/health', (_req, res) => {
    const webProvider = createSearchProvider(options.pipelineDefaults);
    res.json({
      status: 'ok',
      version: options.version ?? '0.0.0',
      components: {
        verification: 'ok',
        thumbnails: 'ok',
        llm: options.pipelineDefaults.ollamaUrl ? 'configured' : 'unavailable',
        queue: options.queueAvailable ? 'ok' : 'unavailable',
      },
      capabilities: {
        batch: Boolean(options.allowBatch),
        screenshots: Boolean(options.screenshot),
        streaming: Boolean(options.runStream),
      },
      limits: {
        requests: rateLimitConfig
          ? { windowMs: rateLimitConfig.windowMs, max: rateLimitConfig.max }
          : null,
        search: searchLimitConfig
          ? { windowMs: searchLimitConfig.windowMs, max: searchLimitConfig.max }
          : null,
      },
      // Which retrieval sources this instance will actually try (ADR-0013).
      sources: {
        papers: ['openalex', 'semantic-scholar', 'europepmc', 'arxiv', 'crossref (fallback)'],
        books: 'configured',
        podcasts: 'configured',
        web: webProvider?.name ?? 'unavailable',
        videos: options.pipelineDefaults.youtubeApiKey ? 'configured' : 'unavailable',
        openAccess: options.pipelineDefaults.mailto ? 'configured' : 'unavailable',
        reranking:
          options.pipelineDefaults.decisionUrl || options.pipelineDefaults.embeddingUrl
            ? 'configured'
            : 'unavailable',
        decision: options.pipelineDefaults.decisionUrl ? 'configured' : 'unavailable',
        embeddings: options.pipelineDefaults.embeddingUrl ? 'configured' : 'unavailable',
      },
    });
  });

  // Local Ollama discovery for the settings panel (talk-buddy pattern):
  // on desktop "local" is the user's machine; on the hosted box it is the
  // service's own Ollama, which is harmless to report.
  app.get('/api/detect-ollama', async (_req, res) => {
    const base = process.env.OLLAMA_DETECT_URL ?? 'http://localhost:11434';
    try {
      const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as {
        models?: Array<{ name?: string; capabilities?: string[] }>;
      };
      const models = data.models ?? [];
      const names = models.map((m) => m.name).filter(Boolean);
      const chatModels = models
        .filter((m) => {
          const capabilities = m.capabilities ?? [];
          return (
            capabilities.some((c) => c === 'completion' || c === 'tools' || c === 'thinking') &&
            !capabilities.includes('decision') &&
            !capabilities.includes('embedding')
          );
        })
        .map((m) => m.name)
        .filter(Boolean);
      res.json({
        available: true,
        url: base,
        models: names,
        chatModels,
        decisionModels: models
          .filter((m) => m.capabilities?.includes('decision'))
          .map((m) => m.name)
          .filter(Boolean),
        embeddingModels: models
          .filter((m) => m.capabilities?.includes('embedding'))
          .map((m) => m.name)
          .filter(Boolean),
      });
    } catch {
      res.json({
        available: false,
        url: base,
        models: [],
        chatModels: [],
        decisionModels: [],
        embeddingModels: [],
      });
    }
  });

  /**
   * Resolve the pipeline config, rejecting client-supplied endpoints that
   * resolve to private/reserved addresses (SSRF, S1). The server's own
   * configured endpoints are trusted and never re-validated here.
   */
  async function buildConfig(
    body: SuggestBody,
  ): Promise<{ pipelineConfig: PipelineConfig; byok: boolean }> {
    const clientUrls = [
      body.provider?.url,
      body.decision?.url,
      body.embeddings?.url,
      body.searxngUrl,
    ].filter(Boolean) as string[];
    for (const url of clientUrls) {
      try {
        await assertPublicUrl(url, options.allowPrivateTargets ?? false);
      } catch {
        throw new BadRequest('Refusing to use a private or invalid provider URL.');
      }
    }
    return mergeConfig(body);
  }

  app.post('/api/suggest', async (req, res) => {
    const body = req.body as SuggestBody;
    const input = body.input?.trim();
    if (!input) {
      res.status(400).json({ error: 'input is required' });
      return;
    }
    let resolved: { pipelineConfig: PipelineConfig; byok: boolean };
    try {
      resolved = await buildConfig(body);
    } catch (error) {
      fail(res, error);
      return;
    }
    const { pipelineConfig, byok } = resolved;
    try {
      const result = await options.run(
        {
          input,
          maxResults: clamp(body.maxResults ?? 10, 1, 25),
          counterpoint: Boolean(body.counterpoint),
          outcomes: body.outcomes,
          constraints: body.constraints,
          context: body.context,
        },
        pipelineConfig,
        byok,
      );
      const topicLabel = input.slice(0, 120);
      switch (body.format) {
        case 'markdown':
          res.setHeader('Content-Disposition', 'attachment; filename="honeyguide-resources.md"');
          res.type('text/markdown').send(toMarkdown(topicLabel, result));
          break;
        case 'html':
          res.setHeader('Content-Disposition', 'attachment; filename="honeyguide-resources.html"');
          res.type('text/html').send(toLmsHtml(topicLabel, result));
          break;
        case 'apa':
        case 'harvard':
          res.setHeader('Content-Disposition', 'attachment; filename="honeyguide-resources.txt"');
          res.type('text/plain').send(toCitations(result, body.format));
          break;
        default:
          res.json(result);
      }
    } catch (error) {
      fail(res, error);
    }
  });

  // Streaming suggest for local/self-host installs: same inputs as
  // /api/suggest, with progress events followed by the final result.
  app.post('/api/suggest/stream', async (req, res) => {
    const runStream = options.runStream;
    if (!runStream) {
      res.status(501).json({ error: 'Streaming is not enabled on this instance.' });
      return;
    }
    const body = req.body as SuggestBody;
    const input = body.input?.trim();
    if (!input) {
      res.status(400).json({ error: 'input is required' });
      return;
    }
    let resolved: { pipelineConfig: PipelineConfig; byok: boolean };
    try {
      resolved = await buildConfig(body);
    } catch (error) {
      fail(res, error);
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();

    // Stop writing (and let the work wind down) if the client disconnects.
    let closed = false;
    req.on('close', () => {
      closed = true;
    });
    const send = (event: string, data: unknown) => {
      if (closed || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await runStream(
        {
          input,
          maxResults: clamp(body.maxResults ?? 10, 1, 25),
          counterpoint: Boolean(body.counterpoint),
          outcomes: body.outcomes,
          constraints: body.constraints,
          context: body.context,
        },
        resolved.pipelineConfig,
        (event) => send('progress', event),
      );
      send('result', result);
      res.end();
    } catch (error) {
      if (!closed) {
        send('error', {
          error: error instanceof BadRequest ? error.message : 'Internal server error',
        });
        if (!(error instanceof BadRequest)) {
          console.error('[honeyguide] stream failed:', error instanceof Error ? error : error);
        }
        res.end();
      }
    }
  });

  // Batch input (spec §9): a self-host/desktop tier capability. Runs
  // inline — the batch helper manages its own concurrency.
  app.post('/api/batch', async (req, res) => {
    if (!options.allowBatch) {
      res.status(403).json({
        error: 'Batch input is a self-host/desktop feature on this instance.',
      });
      return;
    }
    const body = req.body as SuggestBody & { topics?: string[] };
    const topics = (body.topics ?? []).filter((t) => typeof t === 'string');
    if (!topics.length) {
      res.status(400).json({ error: 'topics[] is required' });
      return;
    }
    let resolved: { pipelineConfig: PipelineConfig; byok: boolean };
    try {
      resolved = await buildConfig(body);
    } catch (error) {
      fail(res, error);
      return;
    }
    try {
      const { suggestBatch, toBatchMarkdown } = await import(
        '@michaelborck/honeyguide-core'
      );
      const entries = await suggestBatch(topics, resolved.pipelineConfig, {
        maxResults: clamp(body.maxResults ?? 10, 1, 25),
        counterpoint: Boolean(body.counterpoint),
        outcomes: body.outcomes,
        constraints: body.constraints,
        context: body.context,
      });
      if (body.format === 'markdown') {
        res.type('text/markdown').send(toBatchMarkdown(entries));
      } else {
        res.json({ entries });
      }
    } catch (error) {
      fail(res, error);
    }
  });

  function mergeConfig(body: SuggestBody): { pipelineConfig: PipelineConfig; byok: boolean } {
    const byok = Boolean(
      body.provider?.url ||
        body.youtubeApiKey ||
        body.braveApiKey ||
        body.serperApiKey ||
        body.searxngUrl,
    );
    return {
      byok,
      pipelineConfig: {
        ...options.pipelineDefaults,
        ...(body.provider?.url
          ? {
              ollamaUrl: body.provider.url,
              ollamaApiKey: body.provider.apiKey,
              ollamaModel: body.provider.model,
            }
          : {}),
        ...(body.youtubeApiKey ? { youtubeApiKey: body.youtubeApiKey } : {}),
        ...(body.braveApiKey ? { braveApiKey: body.braveApiKey } : {}),
        ...(body.serperApiKey ? { serperApiKey: body.serperApiKey } : {}),
        ...(body.searxngUrl ? { searxngUrl: body.searxngUrl } : {}),
        ...(typeof body.searchFallbackEnabled === 'boolean'
          ? { searchFallbackEnabled: body.searchFallbackEnabled }
          : {}),
        ...(body.searchFallbackOrder
          ? { searchFallbackOrder: body.searchFallbackOrder }
          : {}),
        ...(body.decision?.url && body.rerank !== 'off'
          ? {
              decisionUrl: body.decision.url,
              decisionModel: body.decision.model || 'tev1:0.8b',
              rerankMode: 'decision' as const,
            }
          : {}),
        ...(body.embeddings?.url && body.rerank !== 'off'
          ? {
              embeddingUrl: body.embeddings.url,
              embeddingModel: body.embeddings.model || 'nomic-embed-text',
              rerankMode: 'embeddings' as const,
            }
          : {}),
        ...(body.rerank === 'off' ? { rerankMode: 'off' as const } : {}),
        ...(options.screenshot ? { screenshot: options.screenshot } : {}),
      },
    };
  }

  // Document input (spec §13): extract text from PDF, DOCX, TXT or MD.
  const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md']);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  });

  app.post('/api/extract', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'file is required' });
      return;
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      res.status(400).json({ error: `unsupported file type ${ext || '(none)'}` });
      return;
    }
    // cite-sight-core's extractors take a path; use a throwaway temp file.
    const tmp = path.join(os.tmpdir(), `honeyguide-${randomBytes(8).toString('hex')}${ext}`);
    try {
      await writeFile(tmp, file.buffer);
      const doc = await extract(tmp);
      res.json({ fileName: file.originalname, text: doc.text.slice(0, 200_000) });
    } catch (error) {
      console.error('[honeyguide] extraction failed:', error instanceof Error ? error : error);
      res.status(422).json({ error: 'Could not extract text from that file.' });
    } finally {
      await unlink(tmp).catch(() => {});
    }
  });

  // Recheck a saved collection: re-probe links and report what changed. This
  // is local/stateless — no persistence, no accounts (ADR-0014).
  app.post('/api/recheck', async (req, res) => {
    const resources = Array.isArray(req.body?.resources) ? req.body.resources : [];
    if (!resources.length) {
      res.status(400).json({ error: 'No resources to recheck.' });
      return;
    }
    try {
      const entries = await recheckResources(resources, {
        allowPrivate: options.allowPrivateTargets ?? false,
      });
      res.json({ entries });
    } catch (error) {
      fail(res, error);
    }
  });

  // Export the result the client is actually showing (including confirmed
  // outcome alignments) without re-running the pipeline (ADR-0017).
  app.post('/api/export', (req, res) => {
    const body = req.body as {
      topic?: string;
      result?: SuggestResult;
      format?: string;
    };
    if (!body.result || !Array.isArray(body.result.resources)) {
      res.status(400).json({ error: 'result.resources[] is required' });
      return;
    }
    const topic = typeof body.topic === 'string' ? body.topic.slice(0, 200) : 'Untitled';
    switch (body.format) {
      case 'markdown':
        res.setHeader('Content-Disposition', 'attachment; filename="honeyguide-resources.md"');
        res.type('text/markdown').send(toMarkdown(topic, body.result));
        break;
      case 'html':
        res.setHeader('Content-Disposition', 'attachment; filename="honeyguide-resources.html"');
        res.type('text/html').send(toLmsHtml(topic, body.result));
        break;
      case 'apa':
      case 'harvard':
        res.setHeader('Content-Disposition', 'attachment; filename="honeyguide-resources.txt"');
        res.type('text/plain').send(toCitations(body.result, body.format));
        break;
      default:
        res.status(400).json({ error: 'format must be markdown, html, apa or harvard' });
    }
  });

  app.use(express.static(options.webDistPath));
  // SPA fallback. Implemented as middleware rather than `app.get('*')` so it
  // works unchanged on Express 5 (whose path syntax no longer accepts a bare
  // '*'). Unknown /api routes get a JSON 404 instead of the HTML shell.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.sendFile(path.join(options.webDistPath, 'index.html'), (err) => {
      if (err) res.status(404).send('Web UI not bundled in this build.');
    });
  });

  return app;
}