import { useState } from 'react';
import { detectOllama } from '../lib/api';
import {
  SERVER_DEFAULTS,
  type DetectedModels,
  type Settings,
} from '../lib/storage';

export function SettingsPanel({
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

  async function runDetect() {
    setDetecting(true);
    setDetectNote(null);
    try {
      const data = await detectOllama();
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
          providerUrl: data.url ?? d.providerUrl,
          model: foundChat[0] ?? d.model,
          decisionUrl: foundDecision.length ? d.decisionUrl || data.url || '' : d.decisionUrl,
          decisionModel: foundDecision[0] ?? (d.decisionModel || 'tev1:0.8b'),
          embeddingUrl: foundEmbedding.length ? d.embeddingUrl || data.url || '' : d.embeddingUrl,
          embeddingModel: foundEmbedding[0] ?? (d.embeddingModel || 'nomic-embed-text'),
        }));
        setModels(foundChat);
        const extra = [
          foundChat.length ? `${foundChat.length} chat` : null,
          foundDecision.length ? `${foundDecision.length} decision` : null,
          foundEmbedding.length ? `${foundEmbedding.length} embedding` : null,
        ].filter(Boolean);
        setDetectNote(
          `Found Ollama with ${(data.models ?? []).length} model(s)` +
            (extra.length ? ` (${extra.join(', ')})` : '') +
            '.',
        );
      } else {
        setDetectNote(
          'No local Ollama found — install from ollama.com, or use the hosted service as-is.',
        );
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
        API keys are kept in this tab&apos;s session, not in long-lived browser storage.
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
      <div className="hg-detect-row">
        <button
          className="hg-btn hg-btn-ghost hg-btn-small"
          onClick={runDetect}
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
          autoComplete="off"
        />
      </label>

      <label>
        Model
        {models.length > 0 ? (
          <select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
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
          autoComplete="off"
        />
      </label>

      <label>
        Brave API key (optional)
        <input
          type="password"
          value={draft.braveApiKey}
          onChange={(e) => setDraft({ ...draft, braveApiKey: e.target.value })}
          placeholder="Brave Search API key"
          autoComplete="off"
        />
      </label>

      <label>
        Serper API key (optional)
        <input
          type="password"
          value={draft.serperApiKey}
          onChange={(e) => setDraft({ ...draft, serperApiKey: e.target.value })}
          placeholder="Serper API key"
          autoComplete="off"
        />
      </label>

      <label>
        SearXNG URL (optional)
        <input
          type="text"
          value={draft.searxngUrl}
          onChange={(e) => setDraft({ ...draft, searxngUrl: e.target.value })}
          placeholder="https://your-searxng-instance.example.com"
        />
      </label>

      <label>
        <input
          type="checkbox"
          checked={draft.searchFallbackEnabled}
          onChange={(e) => setDraft({ ...draft, searchFallbackEnabled: e.target.checked })}
        />{' '}
        Automatic search fallback
      </label>
      <p className="hg-help">
        Try the next configured provider when one fails or returns nothing.
      </p>

      <label>
        Fallback order
        <input
          type="text"
          value={draft.searchFallbackOrder}
          onChange={(e) => setDraft({ ...draft, searchFallbackOrder: e.target.value })}
          disabled={!draft.searchFallbackEnabled}
          placeholder="brave,serper,searxng"
        />
      </label>
      <p className="hg-help">
        Comma-separated. Remove a provider to disable it. The first configured
        provider runs first.
      </p>

      <p className="hg-help">
        <strong>Search usage and costs.</strong> Brave: $5 free credit each month, then $5 per
        1,000 requests (
        <a
          href="https://api-dashboard.search.brave.com/app/keys"
          target="_blank"
          rel="noopener noreferrer"
        >
          dashboard
        </a>
        ). Serper: 2,500 free queries, then prepaid credits (
        <a href="https://serper.dev/dashboard" target="_blank" rel="noopener noreferrer">
          dashboard
        </a>
        ). SearXNG is free to self-host, but upstream engines can rate-limit. Queries leave this
        device and go to the selected provider. Check the provider dashboard for current usage
        and billing.
      </p>

      <label>
        Re-ranking (how results are ordered)
        <select
          value={draft.rerankMode}
          onChange={(e) =>
            setDraft({ ...draft, rerankMode: e.target.value as Settings['rerankMode'] })
          }
        >
          <option value="server">Server default — use this instance&apos;s .env</option>
          <option value="auto">Auto — use a local decision model if detected</option>
          <option value="off">Off — explicitly disable re-ranking</option>
          <option value="embeddings">Embeddings — fast, local</option>
          <option value="decision">System One decision model — best quality</option>
        </select>
      </label>
      {draft.rerankMode === 'server' && (
        <p className="hg-help">
          Uses whatever this instance&apos;s environment configures (or diversity only if none).
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
            Fast and local; a good default is <code>nomic-embed-text</code> (
            <code>ollama pull nomic-embed-text</code>).
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
        Use server defaults clears provider keys, the YouTube key and all model overrides in this
        browser.
      </p>
    </div>
  );
}