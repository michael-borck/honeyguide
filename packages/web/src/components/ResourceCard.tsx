import { verificationText, type Resource } from '@michaelborck/honeyguide-core/web';
import { Badge } from './Badge';

const VERIFY_COLOR: Record<string, string> = {
  verified: '#2f9e6e',
  blocked: '#b07a16',
  paywalled: '#b07a16',
  dead: '#d24b42',
  unverified: '#7a8499',
};

export function ResourceCard({
  r,
  onToggleAlignment,
}: {
  r: Resource;
  onToggleAlignment: (url: string) => void;
}) {
  return (
    <article className="hg-card">
      {r.thumbnailUrl && <img src={r.thumbnailUrl} alt="" className="hg-card-thumb" />}
      <div className="hg-card-body">
        <a href={r.url} target="_blank" rel="noreferrer" className="hg-card-title">
          {r.title}
        </a>
        <div className="hg-card-meta">
          {r.stance === 'counterpoint' && <Badge text="⚖ counterpoint" color="#7b5cc7" />}
          <Badge text={r.format} />
          <Badge text={r.sourceType} />
          <Badge text={verificationText(r.verification, r.verificationBasis)} color={VERIFY_COLOR[r.verification]} />
          {r.access === 'open' && <Badge text="open access" color="#2f9e6e" />}
          {r.access === 'subscription' && <Badge text="subscription" color="#b07a16" />}
          {r.licensing !== 'unknown' && (
            <Badge text={r.licensing.replace(/-/g, ' ')} color="#2f8a5a" />
          )}
          {r.accessibilityNotes.map((note) => (
            <Badge key={note} text={`♿ ${note}`} color="#4a82c0" />
          ))}
          {r.commerciallyInterested && (
            <Badge text="⚠ commercially interested" color="#b07a16" />
          )}
          {r.year && <span>{r.year}</span>}
          {r.authors.length > 0 && <span>{r.authors.slice(0, 3).join(', ')}</span>}
          {r.venue && <span className="hg-meta-text">· {r.venue}</span>}
        </div>
        {r.annotation.text && (
          <p className="hg-annotation">
            <em className="hg-provenance">
              {r.annotation.source === 'llm'
                ? 'Rationale (generated): '
                : 'Description (extracted): '}
            </em>
            {r.annotation.text}
          </p>
        )}
        {r.alignment && (
          <div className="hg-alignment">
            <Badge
              text={`outcome · ${r.alignment.confidence}`}
              color={
                r.alignment.confidence === 'high'
                  ? '#2f9e6e'
                  : r.alignment.confidence === 'medium'
                    ? '#b07a16'
                    : '#7a8499'
              }
            />
            <span className="hg-alignment-text">{r.alignment.outcomeText}</span>
            <span
              className="hg-score"
              title={`Proposed by ${r.alignment.proposedBy}; score ${r.alignment.score.toFixed(2)}`}
            >
              {Math.round(r.alignment.score * 100)}%
            </span>
            <button
              onClick={() => onToggleAlignment(r.url)}
              className={`hg-confirm ${r.alignment.confirmed ? 'is-confirmed' : ''}`}
            >
              {r.alignment.confirmed ? '✓ confirmed' : 'Confirm'}
            </button>
          </div>
        )}
        {r.alignment?.reason && (
          <div className="hg-reason">Why (generated): {r.alignment.reason}</div>
        )}
      </div>
    </article>
  );
}