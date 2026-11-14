import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface Annotation {
  source: 'llm' | 'extracted' | 'none';
  text: string | null;
}

interface Outcome {
  id: string;
  text: string;
}

interface Alignment {
  outcomeId: string;
  outcomeText: string;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  proposedBy: 'decision' | 'embeddings';
  reason?: string;
  confirmed: boolean;
}

interface Resource {
  stance: 'supporting' | 'counterpoint';
  title: string;
  url: string;
  format: string;
  sourceType: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  verification: string;
  verificationBasis: string;
  access: string;
  commerciallyInterested: boolean;
  licensing: string;
  accessibilityNotes: string[];
  annotation: Annotation;
  thumbnailUrl: string | null;
  alignment: Alignment | null;
}

interface SuggestResult {
  resources: Resource[];
  componentHealth: Record<string, string>;
}

interface BatchEntry {
  topic: string;
  result: SuggestResult;
}

interface Health {
  version?: string;
  components?: Record<string, string>;
  capabilities?: Record<string, boolean>;
  sources?: Record<string, string | string[]>;
}

type ProgressStage =
  | 'query'
  | 'retrieve'
  | 'verify'
  | 'rank'
  | 'annotate'
  | 'align'
  | 'done';

interface ProgressEvent {
  stage: ProgressStage;
  detail?: string;
  current?: number;
  total?: number;
}

const STAGE_PERCENT: Record<ProgressStage, number> = {
  query: 8,
  retrieve: 28,
  verify: 46,
  rank: 62,
  annotate: 82,
  align: 92,
  done: 100,
};

function progressLabel(event: ProgressEvent | null): string {
  if (!event) return 'Working…';
  switch (event.stage) {
    case 'query':
      return 'Understanding the input…';
    case 'retrieve':
      return event.detail
        ? `Retrieving ${event.detail.toLowerCase()}…`
        : 'Retrieving sources…';
    case 'verify':
      return 'Verifying links…';
    case 'rank':
      return 'Ranking and diversifying…';
    case 'annotate':
      return event.total
        ? `Annotating ${event.current ?? 0} of ${event.total}…`
        : 'Annotating…';
    case 'align':
      return 'Matching unit outcomes…';
    case 'done':
      return 'Done';
  }
}

function progressPercent(event: ProgressEvent | null): number {
  if (!event) return 12;
  if (event.stage === 'annotate' && event.total) {
    const ratio = Math.max(0, Math.min(1, (event.current ?? 0) / event.total));
    return 62 + (90 - 62) * ratio;
  }
  return STAGE_PERCENT[event.stage] ?? 12;
}

/** Portable collection file, shared with the CLI and desktop (ADR-0014). */
const COLLECTION_KIND = 'honeyguide-collection';
const COLLECTION_SCHEMA_VERSION = 1;

interface CollectionFile {
  kind: typeof COLLECTION_KIND;
  schemaVersion: number;
  topic: string;
  createdAt: string;
  outcomes?: Outcome[];
  brief?: BriefAnswers;
  result: SuggestResult;
}

const OUTCOMES_KEY = 'honeyguide-outcomes';
const THEME_KEY = 'honeyguide-theme';

type ThemeMode = 'light' | 'dark' | 'system';

function loadTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // ignore
  }
  return 'system';
}

function resolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

const OUTCOMES_HEADING =
  /^(?:(?:learning|intended|course|unit|subject|module|program|programme|graduate)\s+)*outcomes?$|^(?:ilos?|clos?|ulos?|slos?)$/i;
const OTHER_HEADING =
  /^(?:week|module|topic|unit|lecture|seminar|workshop|assessment|assessments|resources|readings?|activities|schedule|content|description|overview|introduction)\b/i;

/** Extract outcomes from a plain list or a pasted unit outline. */
function parseOutcomes(text: string): Outcome[] {
  const lines = text.split(/\r?\n/);
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (OUTCOMES_HEADING.test(headingText(lines[i]))) {
      start = i + 1;
      break;
    }
  }
  const hasOutcomesHeading = start > 0;
  const seen = new Set<string>();
  const texts: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const clean = headingText(line);
    if (OUTCOMES_HEADING.test(clean)) continue;
    if (OTHER_HEADING.test(clean)) {
      if (hasOutcomesHeading) break;
      continue;
    }
    const outcome = stripOutcomePrefix(line);
    if (outcome.length < 8) continue;
    const key = outcome.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    texts.push(outcome);
  }
  return texts.map((outcomeText, index) => ({ id: `o${index}`, text: outcomeText }));
}

function headingText(line: string): string {
  return line
    .replace(/^[#*\s]+/, '')
    .replace(/[*\s]+$/, '')
    .replace(/:$/, '')
    .trim();
}

function stripOutcomePrefix(line: string): string {
  return line
    .replace(/^\s*(?:[-*•·▪]|\d+(?:\.\d+)*[.)]?)\s*/, '')
    .replace(/^(?:LO|ILO|CLO|ULO|SLO)\s*\d+\s*[:.)-]?\s*/i, '')
    .replace(/^students?\s+(?:will|should)\s+be\s+able\s+to\s+/i, '')
    .replace(/^students?\s+can\s+/i, '')
    .replace(/^be\s+able\s+to\s+/i, '')
    .trim();
}

/** The four-question interview brief (ADR-0018). */
interface BriefAnswers {
  stance: 'support' | 'challenge' | 'both';
  priorKnowledge: 'none' | 'reading' | 'lecture' | 'notes';
  priorNote: string;
  timing: 'pre-class' | 'in-class' | 'post-class' | 'assessment';
  openAccessOnly: boolean;
  noVideo: boolean;
  recentOnly: boolean;
}

interface SearchConstraints {
  openAccessOnly?: boolean;
  excludeFormats?: string[];
  minYear?: number;
}

interface CompiledBrief {
  counterpoint: boolean;
  constraints: SearchConstraints;
  context: string;
}

const BRIEF_KEY = 'honeyguide-brief';

function defaultBrief(): BriefAnswers {
  return {
    stance: 'support',
    priorKnowledge: 'none',
    priorNote: '',
    timing: 'pre-class',
    openAccessOnly: false,
    noVideo: false,
    recentOnly: false,
  };
}

function loadBrief(): BriefAnswers | null {
  try {
    const raw = localStorage.getItem(BRIEF_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<BriefAnswers>;
    return data && typeof data === 'object' ? { ...defaultBrief(), ...data } : null;
  } catch {
    return null;
  }
}

function compileBrief(
  answers: BriefAnswers,
  currentYear = new Date().getFullYear(),
): CompiledBrief {
  const constraints: SearchConstraints = {};
  if (answers.openAccessOnly) constraints.openAccessOnly = true;
  if (answers.noVideo) constraints.excludeFormats = ['video'];
  if (answers.recentOnly) constraints.minYear = currentYear - 5;

  const prior = {
    none: 'Students have not encountered this topic yet.',
    reading: 'Students have already done a reading on this topic.',
    lecture: 'Students have already had a lecture on this topic.',
    notes: 'Students have their own notes on this topic.',
  }[answers.priorKnowledge];
  const timing = {
    'pre-class': 'This list is preparation before class.',
    'in-class': 'This list will be used during class.',
    'post-class': 'This list follows a class, for consolidation.',
    assessment: 'This list is for assessment preparation.',
  }[answers.timing];
  const stance = {
    support: 'It should reinforce the current framing.',
    challenge: 'It should challenge the current framing and surface disagreement.',
    both: 'It should include both supporting material and counterpoints.',
  }[answers.stance];
  const note = answers.priorNote.trim();

  return {
    counterpoint: answers.stance !== 'support',
    constraints,
    context: [prior, note || null, timing, stance].filter(Boolean).join(' '),
  };
}

function briefSummary(answers: BriefAnswers): string {
  const stance = {
    support: 'Support framing',
    challenge: 'Challenge framing',
    both: 'Support + counterpoints',
  }[answers.stance];
  const prior = {
    none: 'no prior knowledge',
    reading: 'has a reading',
    lecture: 'has had a lecture',
    notes: 'has notes',
  }[answers.priorKnowledge];
  const timing = {
    'pre-class': 'before class',
    'in-class': 'in class',
    'post-class': 'after class',
    assessment: 'for assessment',
  }[answers.timing];
  const constraints = [
    answers.openAccessOnly && 'open access',
    answers.noVideo && 'no video',
    answers.recentOnly && 'recent only',
  ]
    .filter(Boolean)
    .join(', ');
  return `${stance} · ${prior} · ${timing}${constraints ? ` · ${constraints}` : ''}`;
}

interface RecheckEntry {
  resource: Resource;
  previous: string;
  current: string;
  changed: boolean;
}

interface Filters {
  format: string;
  sourceType: string;
  access: string;
  sort: 'default' | 'newest' | 'oldest' | 'title';
}

const DEFAULT_FILTERS: Filters = {
  format: 'all',
  sourceType: 'all',
  access: 'all',
  sort: 'default',
};

function applyFilters(resources: Resource[], filters: Filters): Resource[] {
  const out = resources.filter(
    (r) =>
      (filters.format === 'all' || r.format === filters.format) &&
      (filters.sourceType === 'all' || r.sourceType === filters.sourceType) &&
      (filters.access === 'all' || r.access === filters.access),
  );
  switch (filters.sort) {
    case 'newest':
      out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
      break;
    case 'oldest':
      out.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
      break;
    case 'title':
      out.sort((a, b) => a.title.localeCompare(b.title));
      break;
    default:
      break;
  }
  return out;
}

function hasActiveFilters(filters: Filters): boolean {
  return filters.format !== 'all' || filters.sourceType !== 'all' || filters.access !== 'all';
}

/**
 * BYO credentials live in browser storage only and are sent per request —
 * never persisted server-side (ADR-0004).
 */
interface Settings {
  providerUrl: string;
  apiKey: string;
  model: string;
  youtubeApiKey: string;
  /** Optional local System One decision model for re-ranking (ADR-0016). */
  decisionUrl: string;
  decisionModel: string;
  /** Optional local embeddings endpoint for re-ranking (ADR-0015). */
  embeddingUrl: string;
  embeddingModel: string;
  /**
   * 'auto' uses a detected local decision model (or embeddings) on a
   * localhost/desktop install; explicit modes override it.
   */
  rerankMode: 'server' | 'auto' | 'off' | 'embeddings' | 'decision';
}

interface DetectedModels {
  url: string;
  decisionModels: string[];
  embeddingModels: string[];
}

const SETTINGS_KEY = 'honeyguide-settings';
const EMPTY_SETTINGS: Settings = {
  providerUrl: '',
  apiKey: '',
  model: '',
  youtubeApiKey: '',
  decisionUrl: '',
  decisionModel: 'tev1:0.8b',
  embeddingUrl: '',
  embeddingModel: 'nomic-embed-text',
  rerankMode: 'auto',
};

const SERVER_DEFAULTS: Settings = { ...EMPTY_SETTINGS, rerankMode: 'server' };

function loadSettings(): Settings {
  try {
    return { ...EMPTY_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return EMPTY_SETTINGS;
  }
}

const VERIFY_COLOR: Record<string, string> = {
  verified: '#2f9e6e',
  blocked: '#b07a16',
  paywalled: '#b07a16',
  dead: '#d24b42',
  unverified: '#7a8499',
};

/**
 * The product must not conflate "a database returned this record" with "the
 * link is live and free". Show the basis explicitly.
 */
function verificationLabel(r: Resource): string {
  if (r.verification !== 'verified') return r.verification;
  return r.verificationBasis === 'database' ? 'record found' : 'link live';
}

function healthValue(v: string | string[] | undefined): string {
  if (!v) return '—';
  return Array.isArray(v) ? v.join(', ') : v;
}

export function App() {
  const [topic, setTopic] = useState('');
  const [doc, setDoc] = useState<{ name: string; text: string } | null>(null);
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [batchResult, setBatchResult] = useState<BatchEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [detectedModels, setDetectedModels] = useState<DetectedModels | null>(null);
  const [batchAllowed, setBatchAllowed] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [counterpoint, setCounterpoint] = useState(false);
  const [collectionLabel, setCollectionLabel] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [recheckEntries, setRecheckEntries] = useState<RecheckEntry[] | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [outcomesText, setOutcomesText] = useState(
    () => localStorage.getItem(OUTCOMES_KEY) ?? '',
  );
  const outcomes = useMemo(() => parseOutcomes(outcomesText), [outcomesText]);
  const [brief, setBrief] = useState<BriefAnswers | null>(loadBrief);
  const [showInterview, setShowInterview] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(loadTheme);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const compiledBrief = useMemo(() => (brief ? compileBrief(brief) : null), [brief]);
  const visibleResources = useMemo(
    () => (result ? applyFilters(result.resources, filters) : []),
    [result, filters],
  );

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => {
        setHealth(h);
        setLlmConfigured(h.components?.llm !== 'unavailable');
        setBatchAllowed(Boolean(h.capabilities?.batch));
      })
      .catch(() => {});
  }, []);

  // On a local install (desktop or localhost self-host), discover Ollama
  // models so the default 'auto' re-ranking can use a decision model.
  useEffect(() => {
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
    if (!isLocal) return;
    fetch('/api/detect-ollama')
      .then((r) => r.json())
      .then((data) => {
        if (!data?.available) return;
        setDetectedModels({
          url: String(data.url ?? 'http://localhost:11434'),
          decisionModels: Array.isArray(data.decisionModels) ? data.decisionModels : [],
          embeddingModels: Array.isArray(data.embeddingModels) ? data.embeddingModels : [],
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(OUTCOMES_KEY, outcomesText);
    } catch {
      // storage unavailable; outcomes still work for this session
    }
  }, [outcomesText]);

  useEffect(() => {
    try {
      if (brief) localStorage.setItem(BRIEF_KEY, JSON.stringify(brief));
      else localStorage.removeItem(BRIEF_KEY);
    } catch {
      // storage unavailable; the brief still works for this session
    }
  }, [brief]);

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolvedTheme(theme);
    };
    apply();
    if (theme === 'system') {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  function cycleTheme() {
    setTheme((current) =>
      current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light',
    );
  }

  function saveSettings(next: Settings) {
    setSettings(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }

  /**
   * Resolve the re-ranking payload for this request. 'auto' uses a detected
   * local decision model first, then embeddings, and otherwise sends nothing.
   */
  function rerankFields() {
    if (settings.rerankMode === 'server') return {};
    if (settings.rerankMode === 'off') return { rerank: 'off' };
    if (settings.rerankMode === 'decision') {
      return settings.decisionUrl
        ? {
            rerank: 'decision',
            decision: {
              url: settings.decisionUrl,
              model: settings.decisionModel || 'tev1:0.8b',
            },
          }
        : {};
    }
    if (settings.rerankMode === 'embeddings') {
      return settings.embeddingUrl
        ? {
            rerank: 'embeddings',
            embeddings: {
              url: settings.embeddingUrl,
              model: settings.embeddingModel || 'nomic-embed-text',
            },
          }
        : {};
    }
    // auto
    if (detectedModels?.decisionModels.length) {
      return {
        rerank: 'decision',
        decision: {
          url: detectedModels.url,
          model: detectedModels.decisionModels[0],
        },
      };
    }
    if (detectedModels?.embeddingModels.length) {
      return {
        rerank: 'embeddings',
        embeddings: {
          url: detectedModels.url,
          model: detectedModels.embeddingModels[0],
        },
      };
    }
    return {};
  }

  function credentialFields() {
    return {
      ...(settings.providerUrl
        ? {
            provider: {
              url: settings.providerUrl,
              apiKey: settings.apiKey || undefined,
              model: settings.model || undefined,
            },
          }
        : {}),
      ...(settings.youtubeApiKey ? { youtubeApiKey: settings.youtubeApiKey } : {}),
      ...rerankFields(),
      ...(outcomes.length ? { outcomes } : {}),
      ...((compiledBrief ? compiledBrief.counterpoint : counterpoint)
        ? { counterpoint: true }
        : {}),
      ...(compiledBrief && Object.keys(compiledBrief.constraints).length
        ? { constraints: compiledBrief.constraints }
        : {}),
      ...(compiledBrief?.context ? { context: compiledBrief.context } : {}),
    };
  }

  function topicsFromInput(): string[] {
    return topic
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  async function uploadDoc(file: File) {
    setError(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/extract', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDoc({ name: data.fileName, text: data.text });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    }
  }

  async function streamSuggest(payload: Record<string, unknown>): Promise<SuggestResult> {
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
            const next = parsed as ProgressEvent;
            setProgress((previous) => {
              const current =
                next.stage === 'annotate' && previous?.stage === 'annotate'
                  ? Math.max(previous.current ?? 0, next.current ?? 0)
                  : next.current;
              return { ...next, current };
            });
            setProgressPct((previous) => Math.max(previous, progressPercent(next)));
          } else if (event === 'result') {
            result = parsed as SuggestResult;
            setProgressPct(100);
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

  async function run() {
    const single = doc ? doc.text : topic.trim();
    if (loading || (!single && !batchMode)) return;
    setLoading(true);
    setError(null);
    setProgress(null);
    setProgressPct(0);
    try {
      if (batchMode && !doc) {
        const topics = topicsFromInput();
        if (!topics.length) return;
        const res = await fetch('/api/batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topics, ...credentialFields() }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        setBatchResult((await res.json()).entries);
        setResult(null);
        setRecheckEntries(null);
        setCollectionLabel(null);
      } else {
        const payload = { input: single, ...credentialFields() };
        let next: SuggestResult | null = null;
        if (health?.capabilities?.streaming) {
          setProgress({ stage: 'query' });
          try {
            next = await streamSuggest(payload);
          } catch {
            next = null;
          }
        }
        if (!next) {
          const res = await fetch('/api/suggest', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
          next = await res.json();
        }
        setResult(next);
        setBatchResult(null);
        setRecheckEntries(null);
        setCollectionLabel(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      setResult(null);
      setBatchResult(null);
    } finally {
      setLoading(false);
      setProgress(null);
      setProgressPct(0);
    }
  }

  function toggleAlignment(url: string) {
    const toggle = (res: SuggestResult): SuggestResult => ({
      ...res,
      resources: res.resources.map((resource) =>
        resource.url === url && resource.alignment
          ? {
              ...resource,
              alignment: {
                ...resource.alignment,
                confirmed: !resource.alignment.confirmed,
              },
            }
          : resource,
      ),
    });
    setResult((current) => (current ? toggle(current) : current));
    setBatchResult((current) =>
      current ? current.map((entry) => ({ ...entry, result: toggle(entry.result) })) : current,
    );
  }

  async function download(format: string, extension: string) {
    let res: Response;
    if (batchResult) {
      res = await fetch('/api/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topics: topicsFromInput(), format, ...credentialFields() }),
      });
    } else {
      if (!result) return;
      // Export exactly what the user sees, including confirmed alignments.
      res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: doc ? doc.name : topic.trim(),
          result,
          format,
        }),
      });
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `Export failed (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `honeyguide-resources.${extension}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function saveCollection() {
    if (!result) return;
    const file: CollectionFile = {
      kind: COLLECTION_KIND,
      schemaVersion: COLLECTION_SCHEMA_VERSION,
      topic: doc ? doc.name : topic.trim(),
      createdAt: new Date().toISOString(),
      ...(outcomes.length ? { outcomes } : {}),
      ...(brief ? { brief } : {}),
      result,
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'honeyguide-collection.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function openCollection(file: File) {
    setError(null);
    try {
      const data = JSON.parse(await file.text()) as Partial<CollectionFile>;
      if (data.kind !== COLLECTION_KIND) throw new Error('Not a Honeyguide collection file.');
      if (typeof data.schemaVersion !== 'number' || data.schemaVersion > COLLECTION_SCHEMA_VERSION) {
        throw new Error('This collection was made with a newer version of Honeyguide.');
      }
      if (!data.result || !Array.isArray(data.result.resources)) {
        throw new Error('Collection is missing its resources.');
      }
      setResult(data.result);
      setBatchResult(null);
      setTopic(data.topic ?? '');
      setDoc(null);
      setCollectionLabel(data.topic || file.name);
      setRecheckEntries(null);
      setOutcomesText(
        Array.isArray(data.outcomes) ? data.outcomes.map((o) => o.text).join('\n') : '',
      );
      setBrief(
        data.brief && typeof data.brief === 'object'
          ? { ...defaultBrief(), ...data.brief }
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open collection');
    }
  }

  async function recheckLinks() {
    if (!result || rechecking) return;
    setRechecking(true);
    setError(null);
    try {
      const res = await fetch('/api/recheck', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resources: result.resources }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const data = await res.json();
      setRecheckEntries(data.entries as RecheckEntry[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recheck failed');
    } finally {
      setRechecking(false);
    }
  }

  const llmAvailable = llmConfigured || Boolean(settings.providerUrl);

  return (
    <main className="hg-app">
      <header className="hg-header">
        <h1 className="hg-brand">🪶 Honeyguide</h1>
        <div className="hg-header-actions">
          <button
            onClick={cycleTheme}
            className="hg-btn hg-btn-ghost hg-btn-small"
            title={`Theme: ${theme}`}
            aria-label={`Theme: ${theme}. Click to change.`}
          >
            {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥'}
            <span className="hg-theme-label">{theme}</span>
          </button>
          <button
            onClick={() => setShowSettings((s) => !s)}
            className="hg-btn hg-btn-ghost hg-btn-small"
            aria-expanded={showSettings}
          >
            ⚙ Settings
          </button>
        </div>
      </header>
      <p className="hg-tagline">
        Verified supporting resources for your teaching — every link checked, nothing generated.
      </p>

      {showSettings && (
        <Modal title="Settings" onClose={() => setShowSettings(false)}>
          <SettingsPanel
            settings={settings}
            detected={detectedModels}
            onDetected={setDetectedModels}
            onSave={saveSettings}
            onClose={() => setShowSettings(false)}
          />
        </Modal>
      )}

      {showInterview && (
        <Modal title="Interview" onClose={() => setShowInterview(false)}>
          <InterviewPanel
            initial={brief}
            onApply={(answers) => setBrief(answers)}
            onClose={() => setShowInterview(false)}
          />
        </Modal>
      )}

      <div className="hg-search">
        {batchMode && !doc ? (
          <textarea
            className="hg-textarea"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            aria-label="Topics, one per line"
            placeholder={'One topic per line, e.g.\nsupply chain resilience\nforecasting fundamentals\nlean operations'}
            rows={4}
            style={{ flex: 1 }}
          />
        ) : (
          <input
            className="hg-input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            aria-label="Topic"
            placeholder={doc ? `Using document: ${doc.name}` : 'Topic, e.g. supply chain resilience'}
            disabled={Boolean(doc)}
            style={{ flex: 1 }}
          />
        )}
        <button
          className="hg-btn hg-btn-primary"
          onClick={run}
          disabled={loading || (!doc && !topic.trim())}
        >
          {loading ? 'Searching…' : 'Suggest'}
        </button>
      </div>

      <div className="hg-controls">
        {doc ? (
          <span>
            📄 {doc.name} ({Math.round(doc.text.length / 1000)}k chars){' '}
            <button onClick={() => setDoc(null)} className="hg-btn-quiet">
              ✕ clear
            </button>
          </span>
        ) : (
          <label className="hg-control hg-link">
            📎 …or upload a document (PDF, DOCX, TXT, MD)
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md"
              className="hg-sr-only"
              onChange={(e) => e.target.files?.[0] && uploadDoc(e.target.files[0])}
            />
          </label>
        )}
        <label className="hg-control hg-link">
          📂 Open collection
          <input
            type="file"
            accept=".json,application/json"
            className="hg-sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) openCollection(file);
              e.target.value = '';
            }}
          />
        </label>
        {brief ? (
          <span className="hg-brief">
            🎤 {briefSummary(brief)}
            <button onClick={() => setShowInterview(true)} className="hg-btn-quiet">
              edit
            </button>
            <button onClick={() => setBrief(null)} className="hg-btn-quiet">
              clear
            </button>
          </span>
        ) : (
          <>
            <label className="hg-control">
              <input
                type="checkbox"
                checked={counterpoint}
                onChange={(e) => setCounterpoint(e.target.checked)}
              />{' '}
              ⚖ Include counterpoints
            </label>
            <button onClick={() => setShowInterview(true)} className="hg-btn-quiet">
              🎤 Interview me
            </button>
          </>
        )}
        {batchAllowed && !doc && (
          <label className="hg-control">
            <input
              type="checkbox"
              checked={batchMode}
              onChange={(e) => setBatchMode(e.target.checked)}
            />{' '}
            📚 Batch (one topic per line)
          </label>
        )}
      </div>

      <details className="hg-details">
        <summary>
          🎯 Unit outcomes {outcomes.length ? `(${outcomes.length})` : '(optional)'}
        </summary>
        <textarea
          className="hg-textarea"
          value={outcomesText}
          onChange={(e) => setOutcomesText(e.target.value)}
          rows={4}
          aria-label="Unit outcomes or outline"
          placeholder={'Paste outcomes or a unit outline, e.g.\nLearning outcomes\n1. Explain how spaced repetition improves retention\n2. Evaluate supply-chain resilience strategies'}
        />
        <p className="hg-help">
          A plain list or a unit outline works — headings, week labels and list markers are
          ignored. Resources are matched to outcomes locally; confirm the ones you want, and
          only confirmed tags appear in exports. Re-run after changing outcomes.
        </p>
      </details>

      {!llmAvailable && (
        <p className="hg-note">
          💡 No AI provider configured — results will carry extracted descriptions instead of
          teaching rationales.{' '}
          <button onClick={() => setShowSettings(true)} className="hg-btn-quiet">
            Configure one in Settings.
          </button>
        </p>
      )}

      <div aria-live="polite">
        {error && (
          <p role="alert" className="hg-error">
            Error: {error}
          </p>
        )}
        {loading && (
          <div className="hg-progress" role="status">
            <div className="hg-progress-label">
              <span className="hg-spinner" aria-hidden="true" />
              {progressLabel(progress)}
            </div>
            <div className="hg-progress-track">
              <div
                className={`hg-progress-fill ${progress ? '' : 'is-indeterminate'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {result && (
        <>
          {collectionLabel && (
            <p className="hg-collection-label">📂 Collection: {collectionLabel}</p>
          )}
          <ResultHeader
            count={result.resources.length}
            onDownload={download}
            onSave={saveCollection}
            onRecheck={recheckLinks}
            rechecking={rechecking}
          />
          <FilterBar
            filters={filters}
            onChange={setFilters}
            shown={visibleResources.length}
            total={result.resources.length}
          />
          {recheckEntries && <RecheckReport entries={recheckEntries} />}
          <ResourceSections
            resources={visibleResources}
            onToggleAlignment={toggleAlignment}
          />
          {visibleResources.length === 0 && (
            <p className="hg-empty">
              {result.resources.length === 0
                ? 'No resources found. Try a broader topic, or add retrieval keys for more source types.'
                : 'No resources match these filters.'}{' '}
              {hasActiveFilters(filters) && (
                <button
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="hg-btn-quiet"
                >
                  Clear filters
                </button>
              )}
            </p>
          )}
          <Footers
            result={result}
            health={health}
            hasYoutubeKey={Boolean(settings.youtubeApiKey)}
            openSettings={() => setShowSettings(true)}
          />
        </>
      )}

      {batchResult && (
        <>
          <ResultHeader
            count={batchResult.reduce((n, e) => n + e.result.resources.length, 0)}
            onDownload={download}
          />
          {batchResult.map((entry) => (
            <section key={entry.topic}>
              <h2 className="hg-result-title" style={{ marginTop: 28 }}>
                {entry.topic}
              </h2>
              <ResourceSections
                resources={entry.result.resources}
                onToggleAlignment={toggleAlignment}
              />
            </section>
          ))}
        </>
      )}
    </main>
  );
}

function ResultHeader({
  count,
  onDownload,
  onSave,
  onRecheck,
  rechecking,
}: {
  count: number;
  onDownload: (f: string, e: string) => void;
  onSave?: () => void;
  onRecheck?: () => void;
  rechecking?: boolean;
}) {
  return (
    <div className="hg-result-header">
      <h2 className="hg-result-title">{count} resources</h2>
      <span className="hg-actions">
        {onSave && (
          <button onClick={onSave} className="hg-btn hg-btn-ghost hg-btn-small">
            💾 Save collection
          </button>
        )}
        {onRecheck && (
          <button
            onClick={onRecheck}
            disabled={rechecking}
            className="hg-btn hg-btn-ghost hg-btn-small"
          >
            {rechecking ? 'Checking…' : '🔗 Recheck links'}
          </button>
        )}
        {(
          [
            ['markdown', 'md', 'Markdown'],
            ['html', 'html', 'LMS HTML'],
            ['apa', 'txt', 'APA'],
            ['harvard', 'txt', 'Harvard'],
          ] as const
        ).map(([format, ext, name]) => (
          <button
            key={format}
            onClick={() => onDownload(format, ext)}
            className="hg-btn hg-btn-ghost hg-btn-small"
          >
            ⬇ {name}
          </button>
        ))}
      </span>
    </div>
  );
}

function RecheckReport({ entries }: { entries: RecheckEntry[] }) {
  const changed = entries.filter((e) => e.changed);
  return (
    <div className={`hg-report ${changed.length ? 'hg-report-warn' : 'hg-report-ok'}`}>
      <strong>Link check:</strong> {entries.length} resources, {changed.length} changed.
      {changed.length > 0 && (
        <ul>
          {changed.map((e) => (
            <li key={e.resource.url}>
              {e.resource.title}: {e.previous} → <strong>{e.current}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterBar({
  filters,
  onChange,
  shown,
  total,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  shown: number;
  total: number;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  return (
    <>
      <div className="hg-filterbar" role="group" aria-label="Filter and sort results">
        <label>
          Format
          <select value={filters.format} onChange={(e) => set({ format: e.target.value })}>
            <option value="all">All</option>
            <option value="paper">Papers</option>
            <option value="book">Books</option>
            <option value="podcast">Podcasts</option>
            <option value="video">Videos</option>
            <option value="website">Websites</option>
          </select>
        </label>
        <label>
          Source
          <select value={filters.sourceType} onChange={(e) => set({ sourceType: e.target.value })}>
            <option value="all">All</option>
            <option value="peer-reviewed">Peer-reviewed</option>
            <option value="practitioner">Practitioner</option>
            <option value="vendor">Vendor</option>
            <option value="journalism">Journalism</option>
            <option value="government">Government</option>
          </select>
        </label>
        <label>
          Access
          <select value={filters.access} onChange={(e) => set({ access: e.target.value })}>
            <option value="all">All</option>
            <option value="open">Open access</option>
            <option value="subscription">Subscription</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label>
          Sort
          <select
            value={filters.sort}
            onChange={(e) => set({ sort: e.target.value as Filters['sort'] })}
          >
            <option value="default">Best mix</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">Title A–Z</option>
          </select>
        </label>
        <span className="hg-filter-count">
          {shown} of {total}
        </span>
      </div>
      <p className="hg-legend">
        <strong>record found</strong> = present in a database · <strong>link live</strong> = HTTP
        check passed · <strong>open access</strong> = free to read ·{' '}
        <strong>subscription</strong> = likely paywalled.
      </p>
    </>
  );
}

function ResourceSections({
  resources,
  onToggleAlignment,
}: {
  resources: Resource[];
  onToggleAlignment: (url: string) => void;
}) {
  const supporting = resources.filter((r) => r.stance !== 'counterpoint');
  const counterpoints = resources.filter((r) => r.stance === 'counterpoint');
  return (
    <>
      {supporting.map((r) => (
        <ResourceCard key={r.url} r={r} onToggleAlignment={onToggleAlignment} />
      ))}
      {counterpoints.length > 0 && (
        <>
          <h3 className="hg-section-title">
            ⚖ Counterpoints — disagreeing or complicating material
          </h3>
          {counterpoints.map((r) => (
            <ResourceCard key={r.url} r={r} onToggleAlignment={onToggleAlignment} />
          ))}
        </>
      )}
    </>
  );
}

function ResourceCard({
  r,
  onToggleAlignment,
}: {
  r: Resource;
  onToggleAlignment: (url: string) => void;
}) {
  return (
    <article className="hg-card">
      {r.thumbnailUrl && <img src={r.thumbnailUrl} alt="" className="hg-card-thumb" />}
      <div className="hg-card-body">
        <a href={r.url} target="_blank" rel="noreferrer" className="hg-card-title">
          {r.title}
        </a>
        <div className="hg-card-meta">
          {r.stance === 'counterpoint' && <Badge text="⚖ counterpoint" color="#7b5cc7" />}
          <Badge text={r.format} />
          <Badge text={r.sourceType} />
          <Badge text={verificationLabel(r)} color={VERIFY_COLOR[r.verification]} />
          {r.access === 'open' && <Badge text="open access" color="#2f9e6e" />}
          {r.access === 'subscription' && <Badge text="subscription" color="#b07a16" />}
          {r.licensing !== 'unknown' && (
            <Badge text={r.licensing.replace(/-/g, ' ')} color="#2f8a5a" />
          )}
          {r.accessibilityNotes.map((note) => (
            <Badge key={note} text={`♿ ${note}`} color="#4a82c0" />
          ))}
          {r.commerciallyInterested && (
            <Badge text="⚠ commercially interested" color="#b07a16" />
          )}
          {r.year && <span>{r.year}</span>}
          {r.authors.length > 0 && <span>{r.authors.slice(0, 3).join(', ')}</span>}
          {r.venue && <span className="hg-meta-text">· {r.venue}</span>}
        </div>
        {r.annotation.text && (
          <p className="hg-annotation">
            <em className="hg-provenance">
              {r.annotation.source === 'llm'
                ? 'Rationale (generated): '
                : 'Description (extracted): '}
            </em>
            {r.annotation.text}
          </p>
        )}
        {r.alignment && (
          <div className="hg-alignment">
            <Badge
              text={`outcome · ${r.alignment.confidence}`}
              color={
                r.alignment.confidence === 'high'
                  ? '#2f9e6e'
                  : r.alignment.confidence === 'medium'
                    ? '#b07a16'
                    : '#7a8499'
              }
            />
            <span className="hg-alignment-text">{r.alignment.outcomeText}</span>
            <span
              className="hg-score"
              title={`Proposed by ${r.alignment.proposedBy}; score ${r.alignment.score.toFixed(2)}`}
            >
              {Math.round(r.alignment.score * 100)}%
            </span>
            <button
              onClick={() => onToggleAlignment(r.url)}
              className={`hg-confirm ${r.alignment.confirmed ? 'is-confirmed' : ''}`}
            >
              {r.alignment.confirmed ? '✓ confirmed' : 'Confirm'}
            </button>
          </div>
        )}
        {r.alignment?.reason && (
          <div className="hg-reason">Why (generated): {r.alignment.reason}</div>
        )}
      </div>
    </article>
  );
}

function Footers({
  result,
  health,
  hasYoutubeKey,
  openSettings,
}: {
  result: SuggestResult;
  health: Health | null;
  hasYoutubeKey: boolean;
  openSettings: () => void;
}) {
  return (
    <>
      {result.componentHealth.videos === 'unavailable' && !hasYoutubeKey && (
        <p className="hg-note">
          🎬 Want video results too? Add your own YouTube API key in{' '}
          <button onClick={openSettings} className="hg-btn-quiet">
            Settings
          </button>
          , or <a className="hg-link" href="https://github.com/michael-borck/honeyguide#self-hosting">self-host</a>{' '}
          / grab the{' '}
          <a
            className="hg-link"
            href="https://github.com/michael-borck/honeyguide/releases/latest"
          >
            desktop app
          </a>
          .
        </p>
      )}
      {result.componentHealth.alignment === 'unavailable' && (
        <p className="hg-note hg-note-warn">
          🎯 Outcome alignment is unavailable. Configure a local decision or embedding model in
          Settings to match resources to outcomes.
        </p>
      )}
      <div className="hg-foot">
        <p>
          Components:{' '}
          {Object.entries(result.componentHealth)
            .map(([k, v]) => `${k} ${v === 'ok' ? '✓' : `(${v})`}`)
            .join(' · ')}
        </p>
        {health?.sources && (
          <p>
            Retrieval: {healthValue(health.sources.papers)} · web{' '}
            {healthValue(health.sources.web)} · video {healthValue(health.sources.videos)} · open
            access {healthValue(health.sources.openAccess)}
            {health.version ? ` · v${health.version}` : ''}
          </p>
        )}
      </div>
    </>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);

    (focusable()[0] ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className="hg-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="hg-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="hg-modal-header">
          <h2 id={titleId} className="hg-panel-title">
            {title}
          </h2>
          <button className="hg-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="hg-modal-body">{children}</div>
      </div>
    </div>
  );
}

function InterviewPanel({
  initial,
  onApply,
  onClose,
}: {
  initial: BriefAnswers | null;
  onApply: (answers: BriefAnswers) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<BriefAnswers>(initial ?? defaultBrief());
  const set = (patch: Partial<BriefAnswers>) => setDraft({ ...draft, ...patch });
  const option = (
    name: string,
    value: string,
    label: string,
    current: string,
    onSelect: () => void,
  ) => (
    <label key={value}>
      <input type="radio" name={name} checked={current === value} onChange={onSelect} /> {label}
    </label>
  );

  return (
    <div className="hg-form">
      <p className="hg-help">
        Four quick questions. The brief shapes stance, filters and how rationales are framed;
        retrieval stays the same.
      </p>

      <fieldset>
        <legend>1. Should this support or challenge the current framing?</legend>
        <div className="hg-options">
          {option('stance', 'support', 'Support it', draft.stance, () =>
            set({ stance: 'support' }),
          )}
          {option('stance', 'challenge', 'Challenge it', draft.stance, () =>
            set({ stance: 'challenge' }),
          )}
          {option('stance', 'both', 'Both', draft.stance, () => set({ stance: 'both' }))}
        </div>
      </fieldset>

      <fieldset>
        <legend>2. What will students already have?</legend>
        <div className="hg-options">
          {option('prior', 'none', 'Nothing yet', draft.priorKnowledge, () =>
            set({ priorKnowledge: 'none' }),
          )}
          {option('prior', 'reading', 'A reading', draft.priorKnowledge, () =>
            set({ priorKnowledge: 'reading' }),
          )}
          {option('prior', 'lecture', 'A lecture', draft.priorKnowledge, () =>
            set({ priorKnowledge: 'lecture' }),
          )}
          {option('prior', 'notes', 'Their own notes', draft.priorKnowledge, () =>
            set({ priorKnowledge: 'notes' }),
          )}
        </div>
        <input
          type="text"
          value={draft.priorNote}
          onChange={(e) => set({ priorNote: e.target.value })}
          placeholder="Anything else about what they have? (optional)"
          aria-label="Additional prior knowledge"
        />
      </fieldset>

      <fieldset>
        <legend>3. When will they use it?</legend>
        <div className="hg-options">
          {option('timing', 'pre-class', 'Before class', draft.timing, () =>
            set({ timing: 'pre-class' }),
          )}
          {option('timing', 'in-class', 'In class', draft.timing, () =>
            set({ timing: 'in-class' }),
          )}
          {option('timing', 'post-class', 'After class', draft.timing, () =>
            set({ timing: 'post-class' }),
          )}
          {option('timing', 'assessment', 'For assessment', draft.timing, () =>
            set({ timing: 'assessment' }),
          )}
        </div>
      </fieldset>

      <fieldset>
        <legend>4. Any constraints?</legend>
        <div className="hg-options">
          <label>
            <input
              type="checkbox"
              checked={draft.openAccessOnly}
              onChange={(e) => set({ openAccessOnly: e.target.checked })}
            />{' '}
            Open access only
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.noVideo}
              onChange={(e) => set({ noVideo: e.target.checked })}
            />{' '}
            No video
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.recentOnly}
              onChange={(e) => set({ recentOnly: e.target.checked })}
            />{' '}
            Published in the last 5 years
          </label>
        </div>
      </fieldset>

      <p className="hg-help">Brief: {briefSummary(draft)}</p>

      <div className="hg-form-actions">
        <button
          className="hg-btn hg-btn-primary"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          Use this brief
        </button>
        <button className="hg-btn hg-btn-ghost" onClick={onClose}>
          Skip
        </button>
      </div>
    </div>
  );
}

function SettingsPanel({
  settings,
  detected,
  onDetected,
  onSave,
  onClose,
}: {
  settings: Settings;
  detected: DetectedModels | null;
  onDetected: (detected: DetectedModels) => void;
  onSave: (s: Settings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [detecting, setDetecting] = useState(false);
  const [detectNote, setDetectNote] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [decisionModels, setDecisionModels] = useState<string[]>([]);
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([]);

  async function detectOllama() {
    setDetecting(true);
    setDetectNote(null);
    try {
      const res = await fetch('/api/detect-ollama');
      const data = await res.json();
      if (data.available) {
        const foundChat: string[] = Array.isArray(data.chatModels)
          ? data.chatModels
          : Array.isArray(data.models)
            ? data.models
            : [];
        const foundDecision: string[] = Array.isArray(data.decisionModels)
          ? data.decisionModels
          : [];
        const foundEmbedding: string[] = Array.isArray(data.embeddingModels)
          ? data.embeddingModels
          : [];
        setDecisionModels(foundDecision);
        setEmbeddingModels(foundEmbedding);
        onDetected({
          url: String(data.url ?? 'http://localhost:11434'),
          decisionModels: foundDecision,
          embeddingModels: foundEmbedding,
        });
        setDraft((d) => ({
          ...d,
          providerUrl: data.url,
          model: foundChat[0] ?? d.model,
          decisionUrl: foundDecision.length ? d.decisionUrl || data.url : d.decisionUrl,
          decisionModel: foundDecision[0] ?? (d.decisionModel || 'tev1:0.8b'),
          embeddingUrl: foundEmbedding.length ? d.embeddingUrl || data.url : d.embeddingUrl,
          embeddingModel: foundEmbedding[0] ?? (d.embeddingModel || 'nomic-embed-text'),
        }));
        setModels(foundChat);
        const extra = [
          foundChat.length ? `${foundChat.length} chat` : null,
          foundDecision.length ? `${foundDecision.length} decision` : null,
          foundEmbedding.length ? `${foundEmbedding.length} embedding` : null,
        ].filter(Boolean);
        setDetectNote(
          `Found Ollama with ${data.models.length} model(s)` +
            (extra.length ? ` (${extra.join(', ')})` : '') +
            '.',
        );
      } else {
        setDetectNote('No local Ollama found — install from ollama.com, or use the hosted service as-is.');
      }
    } catch {
      setDetectNote('Detection failed.');
    } finally {
      setDetecting(false);
    }
  }

  return (
    <div className="hg-form">
      <p className="hg-help">
        Keys are stored in this browser only and sent per request — never saved on the server.
      </p>

      <label>
        AI provider URL (Ollama or compatible)
        <input
          type="text"
          value={draft.providerUrl}
          placeholder="http://localhost:11434"
          onChange={(e) => setDraft({ ...draft, providerUrl: e.target.value })}
        />
      </label>
      <div style={{ marginTop: 8 }}>
        <button
          className="hg-btn hg-btn-ghost hg-btn-small"
          onClick={detectOllama}
          disabled={detecting}
        >
          {detecting ? 'Detecting…' : '🔍 Detect local Ollama'}
        </button>
      </div>
      {detectNote && <p className="hg-help">{detectNote}</p>}

      <label>
        API key (if the provider needs one)
        <input
          type="password"
          value={draft.apiKey}
          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
        />
      </label>

      <label>
        Model
        {models.length > 0 ? (
          <select
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          >
            {models.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={draft.model}
            placeholder="llama3.1:8b"
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          />
        )}
      </label>

      <label>
        YouTube API key (enables video search)
        <input
          type="password"
          value={draft.youtubeApiKey}
          onChange={(e) => setDraft({ ...draft, youtubeApiKey: e.target.value })}
        />
      </label>

      <label>
        Re-ranking (how results are ordered)
        <select
          value={draft.rerankMode}
          onChange={(e) =>
            setDraft({ ...draft, rerankMode: e.target.value as Settings['rerankMode'] })
          }
        >
          <option value="server">Server default — use this instance's .env</option>
          <option value="auto">Auto — use a local decision model if detected</option>
          <option value="off">Off — explicitly disable re-ranking</option>
          <option value="embeddings">Embeddings — fast, local</option>
          <option value="decision">System One decision model — best quality</option>
        </select>
      </label>
      {draft.rerankMode === 'server' && (
        <p className="hg-help">
          Uses whatever this instance's environment configures (or diversity only if none).
        </p>
      )}
      {draft.rerankMode === 'off' && (
        <p className="hg-help">
          Overrides any server-configured re-ranker for requests from this browser.
        </p>
      )}
      {draft.rerankMode === 'auto' && (
        <p className="hg-help">
          {detected?.decisionModels.length
            ? `Using ${detected.decisionModels[0]} at ${detected.url}.`
            : detected?.embeddingModels.length
              ? `Using ${detected.embeddingModels[0]} at ${detected.url}.`
              : 'No local decision or embedding model detected — results use diversity only. Use Detect local Ollama to refresh.'}
        </p>
      )}

      {draft.rerankMode === 'decision' && (
        <>
          <label>
            Decision model URL
            <input
              type="text"
              value={draft.decisionUrl}
              placeholder="http://localhost:11434"
              onChange={(e) => setDraft({ ...draft, decisionUrl: e.target.value })}
            />
          </label>
          <label>
            Decision model
            {decisionModels.length > 0 ? (
              <select
                value={draft.decisionModel}
                onChange={(e) => setDraft({ ...draft, decisionModel: e.target.value })}
              >
                {decisionModels.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={draft.decisionModel}
                placeholder="tev1:0.8b"
                onChange={(e) => setDraft({ ...draft, decisionModel: e.target.value })}
              />
            )}
          </label>
          <p className="hg-help">
            Local Ollama 0.35+ decision models judge relevance directly.
            <code> ollama pull tev1:0.8b</code> is the fast default (~7–10s);
            <code> tev1:4b</code> is slower (~25s) with slightly higher accuracy;
            <code> nimble</code> and <code>clef</code> also work.
          </p>
        </>
      )}

      {draft.rerankMode === 'embeddings' && (
        <>
          <label>
            Embeddings URL
            <input
              type="text"
              value={draft.embeddingUrl}
              placeholder="http://localhost:11434"
              onChange={(e) => setDraft({ ...draft, embeddingUrl: e.target.value })}
            />
          </label>
          <label>
            Embedding model
            {embeddingModels.length > 0 ? (
              <select
                value={draft.embeddingModel}
                onChange={(e) => setDraft({ ...draft, embeddingModel: e.target.value })}
              >
                {embeddingModels.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={draft.embeddingModel}
                placeholder="nomic-embed-text"
                onChange={(e) => setDraft({ ...draft, embeddingModel: e.target.value })}
              />
            )}
          </label>
          <p className="hg-help">
            Fast and local; a good default is <code>nomic-embed-text</code> (<code>ollama pull nomic-embed-text</code>).
          </p>
        </>
      )}

      <div className="hg-form-actions">
        <button
          className="hg-btn hg-btn-primary"
          onClick={() => {
            onSave(draft);
            onClose();
          }}
        >
          Save
        </button>
        <button className="hg-btn hg-btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="hg-btn hg-btn-ghost"
          onClick={() => {
            onSave(SERVER_DEFAULTS);
            onClose();
          }}
        >
          Use server defaults
        </button>
      </div>
      <p className="hg-help">
        Use server defaults clears provider keys, the YouTube key and all model overrides in
        this browser.
      </p>
    </div>
  );
}

function Badge({ text, color = '#4a6cc9' }: { text: string; color?: string }) {
  return (
    <span
      className="hg-badge"
      style={{ color, borderColor: `${color}55`, background: `${color}14` }}
    >
      {text}
    </span>
  );
}
