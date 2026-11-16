import type { Resource } from '@michaelborck/honeyguide-core/web';
import { ResourceCard } from './ResourceCard';

export function ResourceSections({
  resources,
  onToggleAlignment,
}: {
  resources: Resource[];
  onToggleAlignment: (url: string) => void;
}) {
  const supporting = resources.filter((r) => r.stance !== 'counterpoint');
  const counterpoints = resources.filter((r) => r.stance === 'counterpoint');
  return (
    <>
      {supporting.map((r) => (
        <ResourceCard key={r.url} r={r} onToggleAlignment={onToggleAlignment} />
      ))}
      {counterpoints.length > 0 && (
        <>
          <h3 className="hg-section-title">⚖ Counterpoints — disagreeing or complicating material</h3>
          {counterpoints.map((r) => (
            <ResourceCard key={r.url} r={r} onToggleAlignment={onToggleAlignment} />
          ))}
        </>
      )}
    </>
  );
}