import type { RecheckEntry } from '../lib/api';

export function RecheckReport({ entries }: { entries: RecheckEntry[] }) {
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