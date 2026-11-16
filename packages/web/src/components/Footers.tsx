import type { SuggestResult } from '@michaelborck/honeyguide-core/web';
import type { Health } from '../lib/api';

function healthValue(v: string | string[] | undefined): string {
  if (!v) return '—';
  return Array.isArray(v) ? v.join(', ') : v;
}

export function Footers({
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
          , or{' '}
          <a
            className="hg-link"
            href="https://github.com/michael-borck/honeyguide#self-hosting"
          >
            self-host
          </a>{' '}
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
            Retrieval: {healthValue(health.sources.papers)} · web {healthValue(health.sources.web)} ·
            video {healthValue(health.sources.videos)} · open access{' '}
            {healthValue(health.sources.openAccess)}
            {health.version ? ` · v${health.version}` : ''}
          </p>
        )}
      </div>
    </>
  );
}