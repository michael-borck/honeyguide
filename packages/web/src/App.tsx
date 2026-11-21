import { useEffect, useMemo, useState } from 'react';
import {
  compileBrief,
  parseCollectionFile,
  parseOutcomes,
  toCollectionFile,
  type BriefAnswers,
  type ProgressEvent,
  type SuggestResult,
} from '@michaelborck/honeyguide-core/web';
import {
  detectOllama,
  extractDocument,
  getHealth,
  postBatch,
  postExport,
  postRecheck,
  postSuggest,
  streamSuggest,
  type Health,
  type RecheckEntry,
} from './lib/api';
import {
  applyFilters,
  DEFAULT_FILTERS,
  hasActiveFilters,
  type Filters,
} from './lib/filters';
import { progressPercent } from './lib/progress';
import {
  loadBrief,
  loadOutcomesText,
  loadSettings,
  loadTheme,
  resolvedTheme,
  saveBrief,
  saveOutcomesText,
  saveSettings,
  saveTheme,
  type DetectedModels,
  type Settings,
  type ThemeMode,
} from './lib/storage';
import { Controls } from './components/Controls';
import { FilterBar } from './components/FilterBar';
import { Footers } from './components/Footers';
import { Header } from './components/Header';
import { InterviewPanel } from './components/InterviewPanel';
import { Modal } from './components/Modal';
import { Progress } from './components/Progress';
import { RecheckReport } from './components/RecheckReport';
import { ResourceSections } from './components/ResourceSections';
import { ResultHeader } from './components/ResultHeader';
import { SearchBar } from './components/SearchBar';
import { SettingsPanel } from './components/SettingsPanel';

interface BatchEntry {
  topic: string;
  result: SuggestResult;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
  const [outcomesText, setOutcomesText] = useState(loadOutcomesText);
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
    getHealth()
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
    detectOllama()
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
    saveOutcomesText(outcomesText);
  }, [outcomesText]);

  useEffect(() => {
    saveBrief(brief);
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
    saveTheme(theme);
  }, [theme]);

  function cycleTheme() {
    setTheme((current) =>
      current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light',
    );
  }

  function storeSettings(next: Settings) {
    setSettings(next);
    saveSettings(next);
  }

  /**
   * Resolve the re-ranking payload for this request. 'auto' uses a detected
   * local decision model first, then embeddings, and otherwise sends nothing.
   */
  function rerankFields(): Record<string, unknown> {
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

  function credentialFields(): Record<string, unknown> {
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
      ...(settings.braveApiKey ? { braveApiKey: settings.braveApiKey } : {}),
      ...(settings.serperApiKey ? { serperApiKey: settings.serperApiKey } : {}),
      ...(settings.searxngUrl ? { searxngUrl: settings.searxngUrl } : {}),
      searchFallbackEnabled: settings.searchFallbackEnabled,
      ...(settings.searchFallbackOrder
        ? { searchFallbackOrder: settings.searchFallbackOrder }
        : {}),
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
    try {
      const data = await extractDocument(file);
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
    setProgress(null);
    setProgressPct(0);
    try {
      if (batchMode && !doc) {
        const topics = topicsFromInput();
        if (!topics.length) return;
        const res = await postBatch({ topics, ...credentialFields() });
        setBatchResult((await res.json()).entries as BatchEntry[]);
        setResult(null);
        setRecheckEntries(null);
        setCollectionLabel(null);
      } else {
        const payload = { input: single, ...credentialFields() };
        let next: SuggestResult | null = null;
        if (health?.capabilities?.streaming) {
          setProgress({ stage: 'query' });
          try {
            next = await streamSuggest(payload, (event) => {
              setProgress((previous) => {
                const current =
                  event.stage === 'annotate' && previous?.stage === 'annotate'
                    ? Math.max(previous.current ?? 0, event.current ?? 0)
                    : event.current;
                return { ...event, current };
              });
              setProgressPct((previous) => Math.max(previous, progressPercent(event)));
            });
          } catch {
            next = null;
          }
        }
        if (!next) {
          const res = await postSuggest(payload);
          next = (await res.json()) as SuggestResult;
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
    if (batchResult) {
      // Export exactly what is on screen without re-running retrieval.
      const parts: string[] = [];
      try {
        for (const entry of batchResult) {
          const res = await postExport({ topic: entry.topic, result: entry.result, format });
          parts.push(await res.text());
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : `Export failed`);
        return;
      }
      const sep = format === 'html' ? '\n' : '\n\n---\n\n';
      const type =
        format === 'html' ? 'text/html' : format === 'markdown' ? 'text/markdown' : 'text/plain';
      downloadBlob(new Blob([parts.join(sep)], { type }), `honeyguide-resources.${extension}`);
      return;
    }
    if (!result) return;
    try {
      const res = await postExport({ topic: doc ? doc.name : topic.trim(), result, format });
      const blob = await res.blob();
      downloadBlob(blob, `honeyguide-resources.${extension}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Export failed`);
    }
  }

  function saveCollection() {
    if (!result) return;
    const file = toCollectionFile(
      doc ? doc.name : topic.trim(),
      result,
      outcomes,
      new Date(),
      brief ?? undefined,
    );
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'honeyguide-collection.json');
  }

  async function openCollection(file: File) {
    setError(null);
    try {
      const data = parseCollectionFile(await file.text());
      setResult(data.result);
      setBatchResult(null);
      setTopic(data.topic ?? '');
      setDoc(null);
      setCollectionLabel(data.topic || file.name);
      setRecheckEntries(null);
      setOutcomesText(
        Array.isArray(data.outcomes) ? data.outcomes.map((o) => o.text).join('\n') : '',
      );
      setBrief(data.brief ? { ...data.brief } : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open collection');
    }
  }

  async function recheckLinks() {
    if (!result || rechecking) return;
    setRechecking(true);
    setError(null);
    try {
      setRecheckEntries(await postRecheck(result.resources));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recheck failed');
    } finally {
      setRechecking(false);
    }
  }

  const llmAvailable = llmConfigured || Boolean(settings.providerUrl);

  return (
    <main className="hg-app">
      <Header
        theme={theme}
        onCycleTheme={cycleTheme}
        onToggleSettings={() => setShowSettings((s) => !s)}
        settingsOpen={showSettings}
        onOpenInterview={() => setShowInterview(true)}
      />

      {showSettings && (
        <Modal title="Settings" onClose={() => setShowSettings(false)}>
          <SettingsPanel
            settings={settings}
            detected={detectedModels}
            searchLimit={health?.limits?.search ?? null}
            onDetected={setDetectedModels}
            onSave={storeSettings}
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

      <SearchBar
        topic={topic}
        onTopicChange={setTopic}
        onSubmit={run}
        loading={loading}
        disabled={Boolean(doc)}
        batchMode={batchMode}
        usingDoc={Boolean(doc)}
      />

      <Controls
        doc={doc}
        onClearDoc={() => setDoc(null)}
        onUploadDoc={uploadDoc}
        onOpenCollection={openCollection}
        brief={brief}
        onEditBrief={() => setShowInterview(true)}
        onClearBrief={() => setBrief(null)}
        counterpoint={counterpoint}
        onCounterpointChange={setCounterpoint}
        batchAllowed={batchAllowed}
        batchMode={batchMode}
        onBatchModeChange={setBatchMode}
      />

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
          placeholder={
            'Paste outcomes or a unit outline, e.g.\nLearning outcomes\n1. Explain how spaced repetition improves retention\n2. Evaluate supply-chain resilience strategies'
          }
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
          <Progress event={progress} percent={progressPct} />
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