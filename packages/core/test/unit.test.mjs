import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diversify,
  classifySource,
  parsePageMeta,
  mapUrlStatus,
  toMarkdown,
  heuristicKeywords,
  extractPhrases,
  reconstructAbstract,
  formatApa,
  formatHarvard,
  toLmsHtml,
  mapOpenAlexLicensing,
  heuristicCounterQueries,
  toRecheckMarkdown,
  toBatchMarkdown,
  createSearchProvider,
  mergePaperCandidates,
  normalizeDoi,
  parseArxivFeed,
  parseEuropePmcResults,
  buildArxivQuery,
  verifyCandidate,
  verificationText,
  mapUnpaywallResponse,
  toCollectionFile,
  parseCollectionFile,
  resourcesFromSaved,
  COLLECTION_KIND,
  COLLECTION_SCHEMA_VERSION,
  cosineSimilarity,
  semanticScores,
  orderByScores,
  CachedEmbeddingProvider,
  CircuitBreaker,
  getCachedJson,
  setCachedJson,
  clearJsonCache,
  buildSystemOneRequest,
  parseSystemOneScores,
  balancedSubset,
  createReranker,
  parseOutcomes,
  buildAlignmentRequest,
  parseAlignmentResponse,
} from '../dist/index.js';

const resource = (over = {}) => ({
  stance: 'supporting',
  title: 'T',
  url: 'https://example.org',
  format: 'paper',
  sourceType: 'peer-reviewed',
  authors: [],
  year: 2024,
  venue: null,
  verification: 'verified',
  verificationBasis: 'database',
  access: 'unknown',
  commerciallyInterested: false,
  licensing: 'unknown',
  annotation: { source: 'none', text: null },
  thumbnailUrl: null,
  accessibilityNotes: [],
  alignment: null,
  ...over,
});

test('diversify round-robins across formats instead of clustering', () => {
  const input = [
    resource({ title: 'p1' }),
    resource({ title: 'p2' }),
    resource({ title: 'p3' }),
    resource({ title: 'v1', format: 'video' }),
    resource({ title: 'b1', format: 'book' }),
  ];
  const out = diversify(input, 4).map((r) => r.title);
  assert.deepEqual(out, ['p1', 'v1', 'b1', 'p2']);
});

test('diversify respects maxResults and exhaustion', () => {
  const out = diversify([resource(), resource()], 10);
  assert.equal(out.length, 2);
});

test('classifySource flags consultancy hosts as commercially interested', () => {
  const { sourceType, commerciallyInterested } = classifySource({
    title: 'Report',
    url: 'https://www.mckinsey.com/insights/ai-report',
    format: 'report',
    authors: [],
    year: null,
    origin: 'searxng',
    databaseAttested: false,
  });
  assert.equal(sourceType, 'vendor');
  assert.equal(commerciallyInterested, true);
});

test('classifySource labels papers peer-reviewed and government by TLD', () => {
  const paper = classifySource({
    title: 'P', url: 'https://doi.org/10.1/x', format: 'paper',
    authors: [], year: null, doi: '10.1/x', origin: 'openalex', databaseAttested: true,
  });
  assert.equal(paper.sourceType, 'peer-reviewed');
  const gov = classifySource({
    title: 'G', url: 'https://www.abs.gov.au/stats', format: 'website',
    authors: [], year: null, origin: 'searxng', databaseAttested: false,
  });
  assert.equal(gov.sourceType, 'government');
});

test('parsePageMeta reads og tags in either attribute order and decodes entities', () => {
  const html = `<head>
    <meta property="og:image" content="https://x.example/img.png">
    <meta content="Tom &amp; Jerry&#039;s guide" property="og:description">
    <meta name="description" content="fallback">
  </head>`;
  const meta = parsePageMeta(html);
  assert.equal(meta.ogImage, 'https://x.example/img.png');
  assert.equal(meta.description, "Tom & Jerry's guide");
});

test('parsePageMeta falls back to name=description', () => {
  const meta = parsePageMeta('<meta name="description" content="plain desc">');
  assert.equal(meta.description, 'plain desc');
});

test('mapUrlStatus never upgrades inconclusive checks', () => {
  assert.equal(mapUrlStatus('live'), 'verified');
  assert.equal(mapUrlStatus('redirect'), 'verified');
  assert.equal(mapUrlStatus('blocked'), 'blocked');
  assert.equal(mapUrlStatus('dead'), 'dead');
  assert.equal(mapUrlStatus('timeout'), 'unverified');
  assert.equal(mapUrlStatus('error'), 'unverified');
});

test('heuristicKeywords surfaces frequent content words, not stopwords', () => {
  const text =
    'Spaced repetition is a learning technique. Spaced repetition schedules ' +
    'reviews of material over increasing intervals, and retrieval practice ' +
    'strengthens memory. The technique of spaced repetition is widely studied.';
  const q = heuristicKeywords(text);
  assert.match(q, /spaced/);
  assert.match(q, /repetition/);
  assert.doesNotMatch(q, /\bthe\b|\bis\b|\band\b/);
});

test('extractPhrases splits on stopwords and keeps multi-word phrases', () => {
  assert.deepEqual(extractPhrases('spaced repetition and retrieval practice in learning'), [
    'spaced repetition',
    'retrieval practice',
  ]);
  assert.deepEqual(extractPhrases('photosynthesis'), []);
});

test('extractPhrases breaks long stopword-free runs into bigrams', () => {
  assert.deepEqual(extractPhrases('spaced repetition retrieval practice memory consolidation'), [
    'spaced repetition',
    'retrieval practice',
    'memory consolidation',
  ]);
});

test('reconstructAbstract rebuilds text from an inverted index', () => {
  const text = reconstructAbstract({
    Testing: [0],
    effects: [1],
    improve: [2],
    retention: [3, 5],
    of: [4],
  });
  assert.equal(text, 'Testing effects improve retention of retention');
});

test('reconstructAbstract truncates at the cap', () => {
  const long = reconstructAbstract({ word: [0, 1, 2, 3, 4] }, 12);
  assert.equal(long.length <= 12, true);
  assert.match(long, /…$/);
});

test('formatApa builds a conventional reference from held metadata', () => {
  const apa = formatApa(
    resource({
      title: 'The critical role of retrieval practice',
      authors: ['Henry Roediger', 'Jeffrey Karpicke'],
      year: 2006,
      venue: 'Psychological Science',
      url: 'https://doi.org/10.1111/x',
    }),
  );
  assert.equal(
    apa,
    'Roediger, H., & Karpicke, J. (2006). The critical role of retrieval practice. *Psychological Science*. https://doi.org/10.1111/x',
  );
});

test('formatHarvard truncates long author lists with et al.', () => {
  const harvard = formatHarvard(
    resource({ authors: ['A One', 'B Two', 'C Three', 'D Four'], year: 2020, title: 'X' }),
  );
  assert.match(harvard, /et al\./);
  assert.match(harvard, /2020,/);
});

test('citations omit missing fields rather than inventing them', () => {
  const apa = formatApa(resource({ authors: [], year: null, venue: null }));
  assert.match(apa, /^\(n\.d\.\)\./);
  assert.doesNotMatch(apa, /undefined|null/);
});

test('toLmsHtml escapes content and uses inline styles only', () => {
  const html = toLmsHtml('a <b> topic', {
    resources: [
      resource({
        title: 'Maths & <scripts>',
        annotation: { source: 'llm', text: 'Covers x < y.' },
      }),
    ],
    componentHealth: {},
  });
  assert.match(html, /a &lt;b&gt; topic/);
  assert.match(html, /Maths &amp; &lt;scripts&gt;/);
  assert.match(html, /Rationale \(generated\):/);
  assert.doesNotMatch(html, /<style|<script/);
});

test('mapOpenAlexLicensing maps CC, OA and closed correctly', () => {
  assert.equal(mapOpenAlexLicensing({ license: 'cc-by', isOa: true }), 'creative-commons');
  assert.equal(mapOpenAlexLicensing({ isOa: true }), 'link-only');
  assert.equal(mapOpenAlexLicensing({ isOa: false }), 'library-subscription');
});

test('heuristicCounterQueries inverts topic phrases with critical terms', () => {
  const queries = heuristicCounterQueries('growth mindset in the classroom');
  assert.ok(queries.length >= 2);
  assert.ok(queries.some((q) => q.includes('growth mindset') && q.includes('criticism')));
});

test('toMarkdown puts counterpoints in their own labelled section', () => {
  const md = toMarkdown('topic', {
    resources: [
      resource({ title: 'For' }),
      resource({ title: 'Against', stance: 'counterpoint', url: 'https://example.org/against' }),
    ],
    componentHealth: {},
  });
  assert.match(md, /## Counterpoints/);
  assert.ok(md.indexOf('For') < md.indexOf('## Counterpoints'));
  assert.ok(md.indexOf('Against') > md.indexOf('## Counterpoints'));
});

test('toRecheckMarkdown lists changes first with old and new status', () => {
  const md = toRecheckMarkdown([
    { resource: resource({ title: 'Fine' }), previous: 'verified', current: 'verified', changed: false },
    { resource: resource({ title: 'Rotted', url: 'https://gone.example' }), previous: 'verified', current: 'dead', changed: true },
  ]);
  assert.match(md, /2 resources, 1 changed/);
  assert.ok(md.indexOf('Rotted') < md.indexOf('Fine'));
  assert.match(md, /verified → \*\*dead\*\*/);
});

test('toBatchMarkdown renders one section per topic', () => {
  const md = toBatchMarkdown([
    { topic: 'alpha', result: { resources: [resource()], componentHealth: {} } },
    { topic: 'beta', result: { resources: [], componentHealth: {} } },
  ]);
  assert.match(md, /# Supporting resources: alpha/);
  assert.match(md, /# Supporting resources: beta/);
});

test('createSearchProvider prefers SearXNG, then keyed providers', () => {
  assert.equal(createSearchProvider({}), null);
  assert.equal(
    createSearchProvider({
      searxngUrl: 'http://searxng:8080',
      braveApiKey: 'brave',
      serperApiKey: 'serper',
    }).name,
    'searxng',
  );
  assert.equal(createSearchProvider({ braveApiKey: 'brave', serperApiKey: 'serper' }).name, 'brave');
  assert.equal(createSearchProvider({ serperApiKey: 'serper' }).name, 'serper');
});

test('normalizeDoi strips resolver prefixes and lower-cases', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1111/ABC'), '10.1111/abc');
  assert.equal(normalizeDoi('doi: 10.1000/XyZ'), '10.1000/xyz');
  assert.equal(normalizeDoi('  10.1/Trim  '), '10.1/trim');
  assert.equal(normalizeDoi(undefined), undefined);
});

const paperCandidate = (over = {}) => ({
  title: 'T',
  url: 'https://doi.org/10.1/x',
  format: 'paper',
  authors: [],
  year: null,
  origin: 'openalex',
  databaseAttested: true,
  ...over,
});

test('mergePaperCandidates dedupes by DOI and fills missing metadata', () => {
  const merged = mergePaperCandidates([
    [paperCandidate({ title: 'Paper One', doi: '10.1/X', url: 'https://doi.org/10.1/x' })],
    [
      paperCandidate({
        title: 'Paper One',
        doi: 'https://doi.org/10.1/x',
        authors: ['Ada Lovelace'],
        year: 2020,
        description: 'An abstract',
        origin: 'semantic-scholar',
      }),
    ],
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].authors, ['Ada Lovelace']);
  assert.equal(merged[0].year, 2020);
  assert.equal(merged[0].description, 'An abstract');
});

test('mergePaperCandidates dedupes by normalised title when no DOI is present', () => {
  const merged = mergePaperCandidates([
    [paperCandidate({ title: 'Spaced Repetition: A Review', doi: undefined })],
    [paperCandidate({ title: 'spaced repetition — a review', doi: undefined, origin: 'arxiv' })],
  ]);
  assert.equal(merged.length, 1);
});

test('mergePaperCandidates keeps distinct papers apart', () => {
  const merged = mergePaperCandidates([
    [
      paperCandidate({ title: 'A', doi: '10.1/a' }),
      paperCandidate({ title: 'B', doi: '10.1/b' }),
    ],
  ]);
  assert.equal(merged.length, 2);
});

test('parseArxivFeed extracts entries and strips version suffixes', () => {
  const xml = `<feed>
    <entry>
      <id>http://arxiv.org/abs/2401.01234v2</id>
      <published>2024-01-03T00:00:00Z</published>
      <title>Retrieval practice &amp; memory</title>
      <summary>An   abstract
      over lines.</summary>
      <author><name>Ada Lovelace</name></author>
    </entry>
  </feed>`;
  const entries = parseArxivFeed(xml);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, 'Retrieval practice & memory');
  assert.equal(entries[0].url, 'https://arxiv.org/abs/2401.01234');
  assert.equal(entries[0].year, 2024);
  assert.deepEqual(entries[0].authors, ['Ada Lovelace']);
  assert.equal(entries[0].summary, 'An abstract over lines.');
});

test('buildArxivQuery uses content phrases and falls back to the raw topic', () => {
  assert.equal(
    buildArxivQuery('spaced repetition and retrieval practice in learning'),
    'all:"spaced repetition" OR all:"retrieval practice"',
  );
  assert.equal(buildArxivQuery('photosynthesis'), 'all:photosynthesis');
});

test('cosineSimilarity handles identical, orthogonal and malformed vectors', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([], []), 0);
  assert.equal(cosineSimilarity([1], [1, 2]), 0);
});

test('semanticScores ranks the relevant candidate first', async () => {
  const fake = {
    name: 'fake',
    async embed(texts) {
      return texts.map((t) => (t.toLowerCase().includes('spaced') ? [1, 0] : [0, 1]));
    },
  };
  const relevant = paperCandidate({ title: 'Spaced repetition in practice' });
  const offTopic = paperCandidate({ title: 'Supply chain logistics' });
  const scores = await semanticScores('spaced repetition', [offTopic, relevant], fake);
  assert.ok(scores.get(relevant) > scores.get(offTopic));
  assert.deepEqual(orderByScores([offTopic, relevant], scores), [relevant, offTopic]);
});

test('buildSystemOneRequest asks one Noul per candidate and truncates text', () => {
  const candidates = [
    paperCandidate({ title: 'Relevant paper', description: 'x'.repeat(1000) }),
    paperCandidate({ title: 'Off topic', description: 'y' }),
  ];
  const { request, idToCandidate } = buildSystemOneRequest(
    'spaced repetition',
    candidates,
    'tev1:4b',
  );
  assert.equal(request.model, 'tev1:4b');
  assert.equal(request.state.topic, 'spaced repetition');
  assert.equal(request.state.candidates.length, 2);
  assert.equal(Object.keys(request.questions).length, 2);
  assert.match(request.questions.c0.instructions, /candidates\[0\]/);
  assert.match(request.questions.c1.instructions, /candidates\[1\]/);
  assert.ok(request.state.candidates[0].description.length <= 240);
  assert.equal(idToCandidate.get('c0'), candidates[0]);
});

test('balancedSubset keeps every format represented within the cap', () => {
  const papers = Array.from({ length: 20 }, (_, i) =>
    paperCandidate({ title: `paper ${i}`, format: 'paper' }),
  );
  const podcasts = Array.from({ length: 5 }, (_, i) =>
    paperCandidate({ title: `podcast ${i}`, format: 'podcast' }),
  );
  const books = Array.from({ length: 5 }, (_, i) =>
    paperCandidate({ title: `book ${i}`, format: 'book' }),
  );
  const subset = balancedSubset([...papers, ...podcasts, ...books], 12);
  assert.equal(subset.length, 12);
  assert.ok(subset.some((c) => c.format === 'podcast'));
  assert.ok(subset.some((c) => c.format === 'book'));
  assert.equal(new Set(subset).size, 12);
});

test('parseSystemOneScores maps Noul answers back to candidates', () => {
  const a = paperCandidate({ title: 'A' });
  const b = paperCandidate({ title: 'B' });
  const idToCandidate = new Map([
    ['c0', a],
    ['c1', b],
  ]);
  const scores = parseSystemOneScores(
    {
      answers: {
        c0: { type: 'noul', noul: 0.9 },
        c1: { type: 'noul', noul: 0.1 },
        bogus: { type: 'noul', noul: 0.5 },
      },
    },
    idToCandidate,
  );
  assert.equal(scores.get(a), 0.9);
  assert.equal(scores.get(b), 0.1);
  assert.equal(scores.size, 2);
});

test('createReranker prefers a decision model, then embeddings', () => {
  assert.equal(createReranker({}), null);
  assert.equal(createReranker({ decisionUrl: 'http://x' }).name, 'ollama-systemone');
  assert.equal(createReranker({ embeddingUrl: 'http://x' }).name, 'embeddings');
  assert.equal(
    createReranker({ decisionUrl: 'http://x', embeddingUrl: 'http://y' }).name,
    'ollama-systemone',
  );
});

test('CachedEmbeddingProvider embeds only texts it has not seen', async () => {
  let calls = 0;
  const inner = {
    name: 'fake',
    async embed(texts) {
      calls += 1;
      return texts.map(() => [1, 0]);
    },
  };
  const cached = new CachedEmbeddingProvider(inner);
  await cached.embed(['a', 'b']);
  await cached.embed(['b', 'c']);
  assert.equal(calls, 2);
  const all = await cached.embed(['a', 'b', 'c']);
  assert.equal(all.length, 3);
  assert.equal(calls, 2);
});

test('CircuitBreaker opens after failures and closes after the cooldown', () => {
  const breaker = new CircuitBreaker(2, 1000);
  const host = 'api.example';
  assert.equal(breaker.canRequest(host, 0), true);
  breaker.recordFailure(host, 0);
  assert.equal(breaker.canRequest(host, 0), true);
  breaker.recordFailure(host, 0);
  assert.equal(breaker.canRequest(host, 500), false);
  assert.equal(breaker.canRequest(host, 1000), true);
  breaker.recordFailure(host, 1000);
  breaker.recordSuccess(host);
  assert.equal(breaker.canRequest(host, 1500), true);
});

test('JSON cache respects its TTL and can be cleared', () => {
  clearJsonCache();
  setCachedJson('k', { a: 1 }, 1000);
  assert.deepEqual(getCachedJson('k', 1500, 1000), { a: 1 });
  assert.equal(getCachedJson('k', 2500, 1000), undefined);
  clearJsonCache();
  assert.equal(getCachedJson('k', 1500, 1000), undefined);
});

test('parseOutcomes strips list markers and numbers outcomes', () => {
  const outcomes = parseOutcomes(
    '- Explain spaced repetition\n2. Evaluate supply chain risk\n\n* Describe retrieval practice',
  );
  assert.deepEqual(
    outcomes.map((o) => o.id),
    ['o0', 'o1', 'o2'],
  );
  assert.equal(outcomes[1].text, 'Evaluate supply chain risk');
});

test('buildAlignmentRequest asks a Choice per resource over outcomes plus none', () => {
  const outcomes = parseOutcomes('Explain spaced repetition\nDescribe retrieval practice');
  const resources = [
    resource({
      title: 'Spaced repetition review',
      annotation: { source: 'extracted', text: 'A review of spacing.' },
    }),
  ];
  const { request, resourceById, outcomeById } = buildAlignmentRequest(
    'study techniques',
    resources,
    outcomes,
    'tev1:0.8b',
  );
  assert.equal(request.questions.r0.type, 'choice');
  assert.match(request.questions.r0.instructions, /resources\[0\]/);
  assert.deepEqual(Object.keys(request.questions.r0.criteria), ['o0', 'o1', 'none']);
  assert.equal(resourceById.get('r0'), resources[0]);
  assert.equal(outcomeById.get('o1').text, 'Describe retrieval practice');
});

test('parseAlignmentResponse maps choices and rescues a close outcome over none', () => {
  const outcomes = parseOutcomes('Explain spaced repetition\nDescribe retrieval practice');
  const first = resource({ title: 'Spaced repetition review' });
  const second = resource({ title: 'Testing effect study' });
  const resourceById = new Map([
    ['r0', first],
    ['r1', second],
  ]);
  const outcomeById = new Map(outcomes.map((o) => [o.id, o]));
  const alignments = parseAlignmentResponse(
    {
      answers: {
        r0: {
          type: 'choice',
          choice: 'o0',
          confidence: 0.9,
          probabilities: { o0: 0.94, o1: 0.01, none: 0.05 },
        },
        r1: {
          type: 'choice',
          choice: 'none',
          confidence: 0.2,
          probabilities: { o0: 0.06, o1: 0.46, none: 0.48 },
        },
      },
    },
    resourceById,
    outcomeById,
  );
  assert.equal(alignments.get(first).outcomeId, 'o0');
  assert.equal(alignments.get(first).confidence, 'high');
  assert.equal(alignments.get(second).outcomeId, 'o1');
  assert.equal(alignments.get(second).confidence, 'low');
});

test('parseAlignmentResponse drops resources that fit no outcome', () => {
  const outcomes = parseOutcomes('Explain spaced repetition');
  const offTopic = resource({ title: 'Supply chain resilience' });
  const resourceById = new Map([['r0', offTopic]]);
  const outcomeById = new Map(outcomes.map((o) => [o.id, o]));
  const alignments = parseAlignmentResponse(
    {
      answers: {
        r0: {
          type: 'choice',
          choice: 'none',
          probabilities: { o0: 0.001, none: 0.999 },
        },
      },
    },
    resourceById,
    outcomeById,
  );
  assert.equal(alignments.size, 0);
});

test('exports include only confirmed outcome alignments', () => {
  const confirmed = resource({
    title: 'A',
    alignment: {
      outcomeId: 'o0',
      outcomeText: 'Explain spacing',
      score: 0.9,
      confidence: 'high',
      proposedBy: 'decision',
      confirmed: true,
    },
  });
  const proposed = resource({
    title: 'B',
    alignment: {
      outcomeId: 'o1',
      outcomeText: 'Describe retrieval',
      score: 0.5,
      confidence: 'medium',
      proposedBy: 'decision',
      confirmed: false,
    },
  });
  const md = toMarkdown('topic', { resources: [confirmed, proposed], componentHealth: {} });
  assert.match(md, /outcome: Explain spacing/);
  assert.doesNotMatch(md, /outcome: Describe retrieval/);
  const html = toLmsHtml('topic', { resources: [confirmed, proposed], componentHealth: {} });
  assert.match(html, /outcome: Explain spacing/);
  assert.doesNotMatch(html, /outcome: Describe retrieval/);
});

test('collection files carry outcomes', () => {
  const outcomes = parseOutcomes('Explain spaced repetition\nDescribe retrieval practice');
  const file = toCollectionFile('t', { resources: [resource()], componentHealth: {} }, outcomes);
  const parsed = parseCollectionFile(JSON.stringify(file));
  assert.deepEqual(
    parsed.outcomes?.map((o) => o.text),
    ['Explain spaced repetition', 'Describe retrieval practice'],
  );
});

test('collection files round-trip and carry their topic', () => {
  const file = toCollectionFile(
    'spaced repetition',
    { resources: [resource()], componentHealth: {} },
    [],
    new Date('2026-11-11T00:00:00Z'),
  );
  assert.equal(file.kind, COLLECTION_KIND);
  assert.equal(file.schemaVersion, COLLECTION_SCHEMA_VERSION);
  assert.equal(file.createdAt, '2026-11-11T00:00:00.000Z');
  const parsed = parseCollectionFile(JSON.stringify(file));
  assert.equal(parsed.topic, 'spaced repetition');
  assert.equal(parsed.result.resources.length, 1);
});

test('collection files drop embedded data-URL thumbnails but keep http ones', () => {
  const embedded = toCollectionFile('t', {
    resources: [resource({ thumbnailUrl: 'data:image/png;base64,AAAA' })],
    componentHealth: {},
  });
  assert.equal(embedded.result.resources[0].thumbnailUrl, null);
  const remote = toCollectionFile('t', {
    resources: [resource({ thumbnailUrl: 'https://example.org/t.png' })],
    componentHealth: {},
  });
  assert.equal(remote.result.resources[0].thumbnailUrl, 'https://example.org/t.png');
});

test('parseCollectionFile rejects non-collections and newer schemas', () => {
  assert.throws(() => parseCollectionFile('{"kind":"other"}'), /Not a Honeyguide collection/);
  assert.throws(
    () =>
      parseCollectionFile(
        JSON.stringify({ kind: COLLECTION_KIND, schemaVersion: 99, result: { resources: [] } }),
      ),
    /newer/,
  );
});

test('resourcesFromSaved reads collections, suggest and batch output', () => {
  const r = resource();
  assert.equal(
    resourcesFromSaved(toCollectionFile('t', { resources: [r], componentHealth: {} })).length,
    1,
  );
  assert.equal(resourcesFromSaved({ resources: [r] }).length, 1);
  assert.equal(resourcesFromSaved({ entries: [{ result: { resources: [r] } }] }).length, 1);
  assert.deepEqual(resourcesFromSaved({}), []);
});

test('verifyCandidate records database attestation as the verification basis', async () => {
  const outcome = await verifyCandidate({
    title: 'P',
    url: 'https://doi.org/10.1/x',
    format: 'paper',
    authors: [],
    year: null,
    doi: '10.1/x',
    origin: 'openalex',
    databaseAttested: true,
  });
  assert.deepEqual(outcome, { status: 'verified', basis: 'database' });
});

test('verificationText keeps database records distinct from live links', () => {
  assert.equal(verificationText('verified', 'database'), 'record found');
  assert.equal(verificationText('verified', 'url-check'), 'link live');
  assert.equal(verificationText('blocked', 'url-check'), 'blocked');
});

test('mapUnpaywallResponse distinguishes open from subscription records', () => {
  assert.deepEqual(
    mapUnpaywallResponse({
      is_oa: true,
      best_oa_location: { url: 'https://oa.example/x', license: 'cc-by' },
    }),
    { access: 'open', oaUrl: 'https://oa.example/x', license: 'cc-by' },
  );
  assert.equal(mapUnpaywallResponse({ is_oa: false }).access, 'subscription');
  assert.equal(mapUnpaywallResponse({}).access, 'subscription');
});

test('parseEuropePmcResults prefers DOI and cleans markup', () => {
  const [paper] = parseEuropePmcResults([
    {
      id: '123',
      source: 'MED',
      title: 'A <b>study</b>',
      doi: '10.1/ABC',
      pubYear: '2021',
      authorList: { author: [{ lastName: 'Doe', firstName: 'Jane' }] },
      journalInfo: { journal: { title: 'Journal' } },
      abstractText: '<p>An abstract</p>',
    },
  ]);
  assert.equal(paper.title, 'A study');
  assert.equal(paper.url, 'https://doi.org/10.1/abc');
  assert.equal(paper.doi, '10.1/abc');
  assert.deepEqual(paper.authors, ['Doe, Jane']);
  assert.equal(paper.description, 'An abstract');
  assert.equal(paper.venue, 'Journal');
});

test('toMarkdown distinguishes generated rationale from extracted description', () => {
  const md = toMarkdown('quantum computing', {
    resources: [
      resource({ annotation: { source: 'llm', text: 'Covers the basics.' } }),
      resource({ annotation: { source: 'extracted', text: 'A survey paper.' } }),
    ],
    componentHealth: { papers: 'ok', llm: 'degraded' },
  });
  assert.match(md, /Rationale \(generated\): Covers the basics\./);
  assert.match(md, /Description \(extracted\): A survey paper\./);
  assert.match(md, /Degraded components this run: llm \(degraded\)/);
  assert.match(md, /none are LLM-generated citations/);
});
