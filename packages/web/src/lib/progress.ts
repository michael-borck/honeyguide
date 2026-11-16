import type { PipelineStage, ProgressEvent } from '@michaelborck/honeyguide-core/web';

const STAGE_PERCENT: Record<PipelineStage, number> = {
  query: 8,
  retrieve: 28,
  verify: 46,
  rank: 62,
  annotate: 82,
  align: 92,
  done: 100,
};

export function progressLabel(event: ProgressEvent | null): string {
  if (!event) return 'Working…';
  switch (event.stage) {
    case 'query':
      return 'Understanding the input…';
    case 'retrieve':
      return event.detail
        ? `Retrieving ${event.detail.toLowerCase()}…`
        : 'Retrieving sources…';
    case 'verify':
      return 'Verifying links…';
    case 'rank':
      return 'Ranking and diversifying…';
    case 'annotate':
      return event.total
        ? `Annotating ${event.current ?? 0} of ${event.total}…`
        : 'Annotating…';
    case 'align':
      return 'Matching unit outcomes…';
    case 'done':
      return 'Done';
  }
}

export function progressPercent(event: ProgressEvent | null): number {
  if (!event) return 12;
  if (event.stage === 'annotate' && event.total) {
    const ratio = Math.max(0, Math.min(1, (event.current ?? 0) / event.total));
    return 62 + (90 - 62) * ratio;
  }
  return STAGE_PERCENT[event.stage] ?? 12;
}