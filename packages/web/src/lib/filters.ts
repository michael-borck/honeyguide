import type { Resource } from '@michaelborck/honeyguide-core/web';

export interface Filters {
  format: string;
  sourceType: string;
  access: string;
  sort: 'default' | 'newest' | 'oldest' | 'title';
}

export const DEFAULT_FILTERS: Filters = {
  format: 'all',
  sourceType: 'all',
  access: 'all',
  sort: 'default',
};

export function applyFilters(resources: Resource[], filters: Filters): Resource[] {
  const out = resources.filter(
    (r) =>
      (filters.format === 'all' || r.format === filters.format) &&
      (filters.sourceType === 'all' || r.sourceType === filters.sourceType) &&
      (filters.access === 'all' || r.access === filters.access),
  );
  switch (filters.sort) {
    case 'newest':
      out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
      break;
    case 'oldest':
      out.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
      break;
    case 'title':
      out.sort((a, b) => a.title.localeCompare(b.title));
      break;
    default:
      break;
  }
  return out;
}

export function hasActiveFilters(filters: Filters): boolean {
  return filters.format !== 'all' || filters.sourceType !== 'all' || filters.access !== 'all';
}