import { briefSummary, type BriefAnswers } from '@michaelborck/honeyguide-core/web';

export function Controls({
  doc,
  onClearDoc,
  onUploadDoc,
  onOpenCollection,
  brief,
  onEditBrief,
  onClearBrief,
  counterpoint,
  onCounterpointChange,
  batchAllowed,
  batchMode,
  onBatchModeChange,
}: {
  doc: { name: string; text: string } | null;
  onClearDoc: () => void;
  onUploadDoc: (file: File) => void;
  onOpenCollection: (file: File) => void;
  brief: BriefAnswers | null;
  onEditBrief: () => void;
  onClearBrief: () => void;
  counterpoint: boolean;
  onCounterpointChange: (value: boolean) => void;
  batchAllowed: boolean;
  batchMode: boolean;
  onBatchModeChange: (value: boolean) => void;
}) {
  return (
    <div className="hg-controls">
      {doc ? (
        <span>
          📄 {doc.name} ({Math.round(doc.text.length / 1000)}k chars){' '}
          <button onClick={onClearDoc} className="hg-btn-quiet">
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
            onChange={(e) => e.target.files?.[0] && onUploadDoc(e.target.files[0])}
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
            if (file) onOpenCollection(file);
            e.target.value = '';
          }}
        />
      </label>
      {brief ? (
        <span className="hg-brief">
          🎤 {briefSummary(brief)}
          <button onClick={onEditBrief} className="hg-btn-quiet">
            edit
          </button>
          <button onClick={onClearBrief} className="hg-btn-quiet">
            clear
          </button>
        </span>
      ) : (
        <>
          <label className="hg-control">
            <input
              type="checkbox"
              checked={counterpoint}
              onChange={(e) => onCounterpointChange(e.target.checked)}
            />{' '}
            ⚖ Include counterpoints
          </label>
          <button onClick={onEditBrief} className="hg-btn-quiet">
            🎤 Interview me
          </button>
        </>
      )}
      {batchAllowed && !doc && (
        <label className="hg-control">
          <input
            type="checkbox"
            checked={batchMode}
            onChange={(e) => onBatchModeChange(e.target.checked)}
          />{' '}
          📚 Batch (one topic per line)
        </label>
      )}
    </div>
  );
}