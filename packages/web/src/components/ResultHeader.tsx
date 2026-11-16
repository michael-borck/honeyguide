const EXPORTS = [
  ['markdown', 'md', 'Markdown'],
  ['html', 'html', 'LMS HTML'],
  ['apa', 'txt', 'APA'],
  ['harvard', 'txt', 'Harvard'],
] as const;

export function ResultHeader({
  count,
  onDownload,
  onSave,
  onRecheck,
  rechecking,
}: {
  count: number;
  onDownload: (format: string, extension: string) => void;
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
        {EXPORTS.map(([format, ext, name]) => (
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