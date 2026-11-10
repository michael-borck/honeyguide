import type { Candidate } from './candidates.js';
import type { SearchProvider } from './search/types.js';

/**
 * General-web retrieval through the configured search provider (ADR-0013).
 * Web results are NOT database-attested: they get a full URL check later.
 */
export async function retrieveWeb(
  topic: string,
  provider: SearchProvider,
): Promise<Candidate[]> {
  const results = await provider.search(topic, { limit: 8 });
  return results.map(
    (r): Candidate => ({
      title: r.title,
      url: r.url,
      format: 'website',
      authors: [],
      year: null,
      description: r.content || undefined,
      origin: provider.name,
      databaseAttested: false,
    }),
  );
}
