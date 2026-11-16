import { useState } from 'react';
import { briefSummary, type BriefAnswers } from '@michaelborck/honeyguide-core/web';
import { defaultBrief } from '../lib/storage';

export function InterviewPanel({
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
          value={draft.priorNote ?? ''}
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