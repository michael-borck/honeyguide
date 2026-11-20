import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FallbackSearchProvider,
  createSearchProviders,
  parseSearchOrder,
  runSearchFallback,
} from '../dist/retrieval/search/index.js';

function provider(name, search) {
  return { name, search };
}

function source(title, url) {
  return { title, url };
}

test('parseSearchOrder keeps known providers and removes duplicates', () => {
  assert.deepEqual(parseSearchOrder(' Brave, serper, brave, nope, searxng '), [
    'brave',
    'serper',
    'searxng',
  ]);
  assert.deepEqual(parseSearchOrder(undefined), ['searxng', 'brave', 'serper']);
});

test('createSearchProviders respects order and fallback off', () => {
  assert.deepEqual(
    createSearchProviders({
      braveApiKey: 'b',
      serperApiKey: 's',
      searchFallbackOrder: 'serper,brave',
    }).map((p) => p.name),
    ['serper', 'brave'],
  );

  assert.deepEqual(
    createSearchProviders({
      braveApiKey: 'b',
      serperApiKey: 's',
      searchFallbackEnabled: false,
    }).map((p) => p.name),
    ['brave'],
  );

  assert.deepEqual(
    createSearchProviders({
      searxngUrl: 'http://searxng',
      searchFallbackOrder: 'brave,searxng',
    }).map((p) => p.name),
    ['searxng'],
  );
});

test('runSearchFallback falls through errors and empty providers', async () => {
  const calls = [];
  const providers = [
    provider('brave', async () => {
      calls.push('brave');
      throw new Error('429 Too Many Requests');
    }),
    provider('serper', async () => {
      calls.push('serper');
      return [];
    }),
    provider('searxng', async () => {
      calls.push('searxng');
      return [source('Third', 'https://example.com/third')];
    }),
  ];

  const results = await runSearchFallback(providers, 'query', 5);

  assert.deepEqual(calls, ['brave', 'serper', 'searxng']);
  assert.equal(results.length, 1);
  assert.equal(results[0].provider, 'searxng');
});

test('runSearchFallback over-fetches, filters invalid URLs and deduplicates', async () => {
  let seenLimit;
  const providers = [
    provider('brave', async (_query, options) => {
      seenLimit = options.limit;
      return [
        source('A', 'https://www.example.com/a/?utm_source=newsletter'),
        source('A again', 'https://example.com/a'),
        source('B', 'https://example.com/b'),
        source('Broken', 'not-a-url'),
      ];
    }),
  ];

  const results = await runSearchFallback(providers, 'query', 4);

  assert.equal(seenLimit, 8);
  assert.equal(results.length, 2);
  assert.equal(results[0].provider, 'brave');
});

test('runSearchFallback throws only when every provider fails', async () => {
  const allFail = [
    provider('brave', async () => {
      throw new Error('brave down');
    }),
    provider('serper', async () => {
      throw new Error('serper down');
    }),
  ];

  await assert.rejects(
    () => runSearchFallback(allFail, 'query', 5),
    /Web search failed: brave: brave down; serper: serper down/,
  );

  const oneEmpty = [
    provider('brave', async () => {
      throw new Error('brave down');
    }),
    provider('serper', async () => []),
  ];
  assert.deepEqual(await runSearchFallback(oneEmpty, 'query', 5), []);
});

test('FallbackSearchProvider reports the first provider name', async () => {
  const chain = new FallbackSearchProvider([
    provider('serper', async () => [source('S', 'https://example.com/s')]),
  ]);

  assert.equal(chain.name, 'serper');
  const results = await chain.search('query', { limit: 3 });
  assert.equal(results.length, 1);
  assert.equal(results[0].provider, 'serper');
});
