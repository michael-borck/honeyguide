import { useEffect, useMemo, useState } from 'react';

interface Annotation {
  source: 'llm' | 'extracted' | 'none';
  text: string | null;
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

/** Portable collection file, shared with the CLI and desktop (ADR-0014). */
const COLLECTION_KIND = 'honeyguide-collection';
const COLLECTION_SCHEMA_VERSION = 1;

interface CollectionFile {
  kind: typeof COLLECTION_KIND;
  schemaVersion: number;
  topic: string;
  createdAt: string;
  result: SuggestResult;
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
  /** Optional local embeddings endpoint for semantic re-ranking (ADR-0015). */
  embeddingUrl: string;
  embeddingModel: string;
}

const SETTINGS_KEY = 'honeyguide-settings';
const EMPTY_SETTINGS: Settings = {
  providerUrl: '',
  apiKey: '',
  model: '',
  youtubeApiKey: '',
  embeddingUrl: '',
  embeddingModel: 'nomic-embed-text',
};

function loadSettings(): Settings {
  try {
    return { ...EMPTY_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return EMPTY_SETTINGS;
  }
}

const VERIFY_COLOR: Record<string, string> = {
  verified: '#1a7f4e',
  blocked: '#a06a00',
  paywalled: '#a06a00',
  dead: '#b3261e',
  unverified: '#666',
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
  const [batchAllowed, setBatchAllowed] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [counterpoint, setCounterpoint] = useState(false);
  const [collectionLabel, setCollectionLabel] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [recheckEntries, setRecheckEntries] = useState<RecheckEntry[] | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
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

  function saveSettings(next: Settings) {
    setSettings(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
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
      ...(settings.embeddingUrl
        ? {
            embeddings: {
              url: settings.embeddingUrl,
              model: settings.embeddingModel || 'nomic-embed-text',
            },
          }
        : {}),
      ...(counterpoint ? { counterpoint: true } : {}),
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

  async function run() {
    const single = doc ? doc.text : topic.trim();
    if (loading || (!single && !batchMode)) return;
    setLoading(true);
    setError(null);
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
        const res = await fetch('/api/suggest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: single, ...credentialFields() }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        setResult(await res.json());
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
    }
  }

  async function download(format: string, extension: string) {
    const endpoint = batchResult ? '/api/batch' : '/api/suggest';
    const payload = batchResult
      ? { topics: topicsFromInput(), format, ...credentialFields() }
      : { input: doc ? doc.text : topic.trim(), format, ...credentialFields() };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
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
  const inputStyle = { flex: 1, padding: '10px 14px', fontSize: 16, borderRadius: 8, border: '1px solid #bbb' } as const;

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 760, margin: '3rem auto', padding: '0 1rem', lineHeight: 1.5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ marginBottom: 4 }}>🪶 Honeyguide</h1>
        <button
          onClick={() => setShowSettings((s) => !s)}
          style={{ border: '1px solid #bbb', background: showSettings ? '#eef1ff' : '#fff', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 14 }}
        >
          ⚙ Settings
        </button>
      </div>
      <p style={{ color: '#555', marginTop: 0 }}>
        Verified supporting resources for your teaching — every link checked, nothing generated.
      </p>

      {showSettings && (
        <SettingsPanel settings={settings} onSave={saveSettings} onClose={() => setShowSettings(false)} />
      )}

      <div style={{ display: 'flex', gap: 8, margin: '1.5rem 0 0.5rem', alignItems: 'flex-start' }}>
        {batchMode && !doc ? (
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            aria-label="Topics, one per line"
            placeholder={'One topic per line, e.g.\nsupply chain resilience\nforecasting fundamentals\nlean operations'}
            rows={4}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        ) : (
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            aria-label="Topic"
            placeholder={doc ? `Using document: ${doc.name}` : 'Topic, e.g. supply chain resilience'}
            disabled={Boolean(doc)}
            style={inputStyle}
          />
        )}
        <button
          onClick={run}
          disabled={loading || (!doc && !topic.trim())}
          style={{ padding: '10px 22px', fontSize: 16, borderRadius: 8, border: 'none', background: '#4054b2', color: '#fff', cursor: 'pointer' }}
        >
          {loading ? 'Searching…' : 'Suggest'}
        </button>
      </div>
      <div style={{ marginBottom: '1.5rem', fontSize: 13, color: '#555', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {doc ? (
          <span>
            📄 {doc.name} ({Math.round(doc.text.length / 1000)}k chars){' '}
            <button onClick={() => setDoc(null)} style={{ border: 'none', background: 'none', color: '#4054b2', cursor: 'pointer' }}>
              ✕ clear
            </button>
          </span>
        ) : (
          <label style={{ cursor: 'pointer', color: '#4054b2' }}>
            📎 …or upload a document (PDF, DOCX, TXT, MD)
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && uploadDoc(e.target.files[0])}
            />
          </label>
        )}
        <label style={{ cursor: 'pointer', color: '#4054b2' }}>
          📂 Open collection
          <input
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) openCollection(file);
              e.target.value = '';
            }}
          />
        </label>
        <label style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={counterpoint} onChange={(e) => setCounterpoint(e.target.checked)} />{' '}
          ⚖ Include counterpoints
        </label>
        {batchAllowed && !doc && (
          <label style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={batchMode} onChange={(e) => setBatchMode(e.target.checked)} />{' '}
            📚 Batch (one topic per line)
          </label>
        )}
      </div>

      {!llmAvailable && (
        <p style={{ fontSize: 13, color: '#555' }}>
          💡 No AI provider configured — results will carry extracted descriptions instead of
          teaching rationales.{' '}
          <button onClick={() => setShowSettings(true)} style={{ border: 'none', background: 'none', color: '#4054b2', cursor: 'pointer', padding: 0, fontSize: 13 }}>
            Configure one in Settings.
          </button>
        </p>
      )}

      <div aria-live="polite">
        {error && (
          <p role="alert" style={{ color: '#b3261e' }}>
            Error: {error}
          </p>
        )}
        {loading && (
          <p role="status" style={{ color: '#555' }}>
            <span className="hg-spinner" aria-hidden="true" />
            Retrieving, verifying and annotating — this can take a moment…
          </p>
        )}
      </div>

      {result && (
        <>
          {collectionLabel && (
            <p style={{ fontSize: 13, color: '#555', marginTop: 0 }}>
              📂 Collection: {collectionLabel}
            </p>
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
          <ResourceSections resources={visibleResources} />
          {visibleResources.length === 0 && (
            <p className="hg-empty">
              {result.resources.length === 0
                ? 'No resources found. Try a broader topic, or add retrieval keys for more source types.'
                : 'No resources match these filters.'}{' '}
              {hasActiveFilters(filters) && (
                <button
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: '#4054b2',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: 14,
                    textDecoration: 'underline',
                  }}
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
            <section key={entry.topic} style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 17, borderBottom: '2px solid #e3e3e3', paddingBottom: 4 }}>
                {entry.topic}
              </h2>
              <ResourceSections resources={entry.result.resources} />
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
  const buttonStyle = {
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid #bbb',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 13,
  } as const;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
      <h2 style={{ fontSize: 18 }}>{count} resources</h2>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {onSave && (
          <button onClick={onSave} style={buttonStyle}>
            💾 Save collection
          </button>
        )}
        {onRecheck && (
          <button onClick={onRecheck} disabled={rechecking} style={buttonStyle}>
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
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #bbb', background: '#fff', cursor: 'pointer', fontSize: 13 }}
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
    <div
      style={{
        marginTop: 12,
        padding: '10px 14px',
        background: changed.length ? '#fff8e6' : '#f2fbf5',
        borderRadius: 8,
        fontSize: 13,
      }}
    >
      <strong>Link check:</strong> {entries.length} resources, {changed.length} changed.
      {changed.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
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

function ResourceSections({ resources }: { resources: Resource[] }) {
  const supporting = resources.filter((r) => r.stance !== 'counterpoint');
  const counterpoints = resources.filter((r) => r.stance === 'counterpoint');
  return (
    <>
      {supporting.map((r) => (
        <ResourceCard key={r.url} r={r} />
      ))}
      {counterpoints.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, marginTop: 20, color: '#6a3fb2' }}>
            ⚖ Counterpoints — material that disagrees with or complicates the framing
          </h3>
          {counterpoints.map((r) => (
            <ResourceCard key={r.url} r={r} />
          ))}
        </>
      )}
    </>
  );
}

function ResourceCard({ r }: { r: Resource }) {
  return (
    <article style={{ display: 'flex', gap: 14, padding: '14px 0', borderTop: '1px solid #e3e3e3' }}>
      {r.thumbnailUrl && (
        <img src={r.thumbnailUrl} alt="" style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
      )}
      <div>
        <a href={r.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: '#1a3faa' }}>
          {r.title}
        </a>
        <div style={{ fontSize: 13, color: '#555', margin: '4px 0' }}>
          {r.stance === 'counterpoint' && <Badge text="⚖ counterpoint" color="#6a3fb2" />}
          <Badge text={r.format} />
          <Badge text={r.sourceType} />
          <Badge text={verificationLabel(r)} color={VERIFY_COLOR[r.verification]} />
          {r.access === 'open' && <Badge text="open access" color="#1a7f4e" />}
          {r.access === 'subscription' && <Badge text="subscription" color="#a06a00" />}
          {r.licensing !== 'unknown' && <Badge text={r.licensing.replace(/-/g, ' ')} color="#2e6f40" />}
          {r.accessibilityNotes.map((note) => (
            <Badge key={note} text={`♿ ${note}`} color="#376a9e" />
          ))}
          {r.commerciallyInterested && <Badge text="⚠ commercially interested" color="#a06a00" />}
          {r.year && <span style={{ marginRight: 8 }}>{r.year}</span>}
          {r.authors.length > 0 && <span>{r.authors.slice(0, 3).join(', ')}</span>}
          {r.venue && <span style={{ color: '#888' }}> · {r.venue}</span>}
        </div>
        {r.annotation.text && (
          <p style={{ margin: '4px 0 0', fontSize: 14 }}>
            <em style={{ color: '#777', fontStyle: 'normal', fontSize: 12 }}>
              {r.annotation.source === 'llm' ? 'Rationale (generated): ' : 'Description (extracted): '}
            </em>
            {r.annotation.text}
          </p>
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
        <p style={{ fontSize: 13, color: '#555', marginTop: 16, padding: '10px 14px', background: '#f4f6ff', borderRadius: 8 }}>
          🎬 Want video results too? Add your own YouTube API key in{' '}
          <button onClick={openSettings} style={{ border: 'none', background: 'none', color: '#4054b2', cursor: 'pointer', padding: 0, fontSize: 13 }}>
            Settings
          </button>
          , or{' '}
          <a href="https://github.com/michael-borck/honeyguide#self-hosting" style={{ color: '#4054b2' }}>
            self-host
          </a>{' '}
          / grab the{' '}
          <a href="https://github.com/michael-borck/honeyguide/releases/latest" style={{ color: '#4054b2' }}>
            desktop app
          </a>
          .
        </p>
      )}
      <p style={{ fontSize: 12, color: '#888', marginTop: 12 }}>
        Components:{' '}
        {Object.entries(result.componentHealth)
          .map(([k, v]) => `${k} ${v === 'ok' ? '✓' : `(${v})`}`)
          .join(' · ')}
      </p>
      {health?.sources && (
        <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
          Retrieval: {healthValue(health.sources.papers)} · web {healthValue(health.sources.web)} ·
          video {healthValue(health.sources.videos)} · open access{' '}
          {healthValue(health.sources.openAccess)}
          {health.version ? ` · v${health.version}` : ''}
        </p>
      )}
    </>
  );
}

function SettingsPanel({
  settings,
  onSave,
  onClose,
}: {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [detecting, setDetecting] = useState(false);
  const [detectNote, setDetectNote] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);

  async function detectOllama() {
    setDetecting(true);
    setDetectNote(null);
    try {
      const res = await fetch('/api/detect-ollama');
      const data = await res.json();
      if (data.available) {
        setDraft((d) => ({
          ...d,
          providerUrl: data.url,
          model: data.models[0] ?? d.model,
          embeddingUrl: d.embeddingUrl || data.url,
          embeddingModel: d.embeddingModel || 'nomic-embed-text',
        }));
        setModels(data.models);
        setDetectNote(`Found Ollama with ${data.models.length} model(s).`);
      } else {
        setDetectNote('No local Ollama found — install from ollama.com, or use the hosted service as-is.');
      }
    } catch {
      setDetectNote('Detection failed.');
    } finally {
      setDetecting(false);
    }
  }

  const field = { display: 'block', width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #bbb', fontSize: 14, marginTop: 4 } as const;
  const label = { fontSize: 13, color: '#444', display: 'block', marginTop: 12 } as const;

  return (
    <section style={{ border: '1px solid #ccd', borderRadius: 10, padding: '14px 18px', margin: '1rem 0', background: '#fafbff' }}>
      <strong style={{ fontSize: 15 }}>Settings</strong>
      <p style={{ fontSize: 12, color: '#777', margin: '4px 0 0' }}>
        Keys are stored in this browser only and sent per request — never saved on the server.
      </p>

      <label style={label}>
        AI provider URL (Ollama or compatible)
        <input style={field} value={draft.providerUrl} placeholder="http://localhost:11434"
          onChange={(e) => setDraft({ ...draft, providerUrl: e.target.value })} />
      </label>
      <button onClick={detectOllama} disabled={detecting}
        style={{ marginTop: 6, padding: '5px 10px', borderRadius: 6, border: '1px solid #bbb', background: '#fff', cursor: 'pointer', fontSize: 12 }}>
        {detecting ? 'Detecting…' : '🔍 Detect local Ollama'}
      </button>
      {detectNote && <span style={{ fontSize: 12, color: '#555', marginLeft: 8 }}>{detectNote}</span>}

      <label style={label}>
        API key (if the provider needs one)
        <input style={field} type="password" value={draft.apiKey}
          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} />
      </label>

      <label style={label}>
        Model
        {models.length > 0 ? (
          <select style={field} value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
            {models.map((m) => <option key={m}>{m}</option>)}
          </select>
        ) : (
          <input style={field} value={draft.model} placeholder="llama3.1:8b"
            onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
        )}
      </label>

      <label style={label}>
        YouTube API key (enables video search)
        <input style={field} type="password" value={draft.youtubeApiKey}
          onChange={(e) => setDraft({ ...draft, youtubeApiKey: e.target.value })} />
      </label>

      <label style={label}>
        Embeddings URL (optional — enables semantic re-ranking)
        <input style={field} value={draft.embeddingUrl} placeholder="http://localhost:11434"
          onChange={(e) => setDraft({ ...draft, embeddingUrl: e.target.value })} />
      </label>
      <label style={label}>
        Embedding model
        <input style={field} value={draft.embeddingModel} placeholder="nomic-embed-text"
          onChange={(e) => setDraft({ ...draft, embeddingModel: e.target.value })} />
      </label>
      <p style={{ fontSize: 12, color: '#777', margin: '4px 0 0' }}>
        Re-orders results by relevance before balancing formats. Local only; a good default is
        <code> nomic-embed-text</code> (<code>ollama pull nomic-embed-text</code>).
      </p>

      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button onClick={() => { onSave(draft); onClose(); }}
          style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#4054b2', color: '#fff', cursor: 'pointer' }}>
          Save
        </button>
        <button onClick={onClose}
          style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid #bbb', background: '#fff', cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function Badge({ text, color = '#4054b2' }: { text: string; color?: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        marginRight: 6,
        borderRadius: 10,
        fontSize: 12,
        color: '#fff',
        background: color,
      }}
    >
      {text}
    </span>
  );
}
