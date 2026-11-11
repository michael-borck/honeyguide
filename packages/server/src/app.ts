import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import express from 'express';
import multer from 'multer';
import {
  toMarkdown,
  toCitations,
  toLmsHtml,
  extract,
  recheckResources,
  createSearchProvider,
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
  /** Optional per-request local embeddings for semantic re-ranking (ADR-0015). */
  embeddings?: { url?: string; model?: string };
  /** Optional per-request local System One decision model (ADR-0016). */
  decision?: { url?: string; model?: string };
  /** Optional unit outcomes; when present the pipeline proposes alignments. */
  outcomes?: Outcome[];
  /** Interview brief constraints and teaching context (ADR-0018). */
  constraints?: SearchConstraints;
  context?: string;
  counterpoint?: boolean;
}

export function createApp(options: AppOptions): express.Express {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

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

  app.post('/api/suggest', async (req, res) => {
    const body = req.body as SuggestBody;
    const input = body.input?.trim();
    if (!input) {
      res.status(400).json({ error: 'input is required' });
      return;
    }
    const { pipelineConfig, byok } = mergeConfig(body);
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
          res.type('text/markdown').send(toMarkdown(topicLabel, result));
          break;
        case 'html':
          res.type('text/html').send(toLmsHtml(topicLabel, result));
          break;
        case 'apa':
        case 'harvard':
          res.type('text/plain').send(toCitations(result, body.format));
          break;
        default:
          res.json(result);
      }
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
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
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const { pipelineConfig } = mergeConfig(body);
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
        pipelineConfig,
        (event) => send('progress', event),
      );
      send('result', result);
      res.end();
    } catch (error) {
      send('error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.end();
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
    const { pipelineConfig } = mergeConfig(body);
    try {
      const { suggestBatch, toBatchMarkdown } = await import(
        '@michaelborck/honeyguide-core'
      );
      const entries = await suggestBatch(topics, pipelineConfig, {
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
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  function mergeConfig(body: SuggestBody): { pipelineConfig: PipelineConfig; byok: boolean } {
    const byok = Boolean(body.provider?.url || body.youtubeApiKey);
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
        ...(body.decision?.url
          ? {
              decisionUrl: body.decision.url,
              decisionModel: body.decision.model || 'tev1:0.8b',
            }
          : {}),
        ...(body.embeddings?.url
          ? {
              embeddingUrl: body.embeddings.url,
              embeddingModel: body.embeddings.model || 'nomic-embed-text',
            }
          : {}),
        ...(options.screenshot ? { screenshot: options.screenshot } : {}),
      },
    };
  }

  // Document input (spec §13): extract text from PDF, DOCX, TXT or MD.
  const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md']);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
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
      res.status(422).json({
        error: error instanceof Error ? error.message : 'extraction failed',
      });
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
      res.json({ entries: await recheckResources(resources) });
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : 'recheck failed' });
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
        res.type('text/markdown').send(toMarkdown(topic, body.result));
        break;
      case 'html':
        res.type('text/html').send(toLmsHtml(topic, body.result));
        break;
      case 'apa':
      case 'harvard':
        res.type('text/plain').send(toCitations(body.result, body.format));
        break;
      default:
        res.status(400).json({ error: 'format must be markdown, html, apa or harvard' });
    }
  });

  app.use(express.static(options.webDistPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(options.webDistPath, 'index.html'), (err) => {
      if (err) res.status(404).send('Web UI not bundled in this build.');
    });
  });

  return app;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}
