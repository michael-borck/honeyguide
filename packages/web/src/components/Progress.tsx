import type { ProgressEvent } from '@michaelborck/honeyguide-core/web';
import { progressLabel } from '../lib/progress';

export function Progress({ event, percent }: { event: ProgressEvent | null; percent: number }) {
  return (
    <div className="hg-progress" role="status">
      <div className="hg-progress-label">
        <span className="hg-spinner" aria-hidden="true" />
        {progressLabel(event)}
      </div>
      <div className="hg-progress-track">
        <div
          className={`hg-progress-fill ${event ? '' : 'is-indeterminate'}`}
          style={{ width: `${event ? percent : 35}%` }}
        />
      </div>
    </div>
  );
}