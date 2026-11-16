import type { Filters } from '../lib/filters';

const FORMAT_OPTIONS: Array<[string, string]> = [
  ['all', 'All'],
  ['paper', 'Papers'],
  ['book', 'Books'],
  ['podcast', 'Podcasts'],
  ['video', 'Videos'],
  ['website', 'Websites'],
];

const SOURCE_OPTIONS: Array<[string, string]> = [
  ['all', 'All'],
  ['peer-reviewed', 'Peer-reviewed'],
  ['practitioner', 'Practitioner'],
  ['vendor', 'Vendor'],
  ['journalism', 'Journalism'],
  ['government', 'Government'],
];

const ACCESS_OPTIONS: Array<[string, string]> = [
  ['all', 'All'],
  ['open', 'Open access'],
  ['subscription', 'Subscription'],
  ['unknown', 'Unknown'],
];

export function FilterBar({
  filters,
  onChange,
  shown,
  total,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  shown: number;
  total: number;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  return (
    <>
      <div className="hg-filterbar" role="group" aria-label="Filter and sort results">
        <label>
          Format
          <select value={filters.format} onChange={(e) => set({ format: e.target.value })}>
            {FORMAT_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source
          <select value={filters.sourceType} onChange={(e) => set({ sourceType: e.target.value })}>
            {SOURCE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Access
          <select value={filters.access} onChange={(e) => set({ access: e.target.value })}>
            {ACCESS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select
            value={filters.sort}
            onChange={(e) => set({ sort: e.target.value as Filters['sort'] })}
          >
            <option value="default">Best mix</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">Title A–Z</option>
          </select>
        </label>
        <span className="hg-filter-count">
          {shown} of {total}
        </span>
      </div>
      <p className="hg-legend">
        <strong>record found</strong> = present in a database · <strong>link live</strong> = HTTP
        check passed · <strong>open access</strong> = free to read ·{' '}
        <strong>subscription</strong> = likely paywalled.
      </p>
    </>
  );
}