export function SearchBar({
  topic,
  onTopicChange,
  onSubmit,
  loading,
  disabled,
  batchMode,
  usingDoc,
}: {
  topic: string;
  onTopicChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  disabled: boolean;
  batchMode: boolean;
  usingDoc: boolean;
}) {
  if (batchMode && !usingDoc) {
    return (
      <div className="hg-search">
        <textarea
          className="hg-textarea"
          value={topic}
          onChange={(e) => onTopicChange(e.target.value)}
          aria-label="Topics, one per line"
          placeholder={
            'One topic per line, e.g.\nsupply chain resilience\nforecasting fundamentals\nlean operations'
          }
          rows={4}
          style={{ flex: 1 }}
        />
        <button className="hg-btn hg-btn-primary" onClick={onSubmit} disabled={loading || !topic.trim()}>
          {loading ? 'Searching…' : 'Suggest'}
        </button>
      </div>
    );
  }
  return (
    <div className="hg-search">
      <input
        className="hg-input"
        value={topic}
        onChange={(e) => onTopicChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        aria-label="Topic"
        placeholder={usingDoc ? 'Using document — enter a topic to override' : 'Topic, e.g. supply chain resilience'}
        disabled={disabled}
        style={{ flex: 1 }}
      />
      <button
        className="hg-btn hg-btn-primary"
        onClick={onSubmit}
        disabled={loading || (!usingDoc && !topic.trim())}
      >
        {loading ? 'Searching…' : 'Suggest'}
      </button>
    </div>
  );
}