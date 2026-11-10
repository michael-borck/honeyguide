#!/usr/bin/env node
/**
 * Golden-set evaluation (docs/plan-bigger-bets.md, Enabler 0).
 *
 * Runs the real pipeline against a small set of representative teaching
 * topics and reports retrieval coverage, a relevance proxy, format diversity,
 * open-access share and latency. It is network-dependent, so it is a manual
 * tool rather than a CI gate; `--strict` makes it exit non-zero.
 *
 * Usage:
 *   npm run eval            # human-readable table
 *   npm run eval -- --json  # JSON for diffing baselines
 *   npm run eval -- --strict
 */
import { readFile } from 'node:fs/promises';
import { suggestResources, configFromEnv } from '../packages/core/dist/index.js';

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const strict = args.has('--strict');
const maxResults = 10;

const cases = JSON.parse(
  await readFile(new URL('../eval/golden-set.json', import.meta.url), 'utf8'),
);

function relevance(resource, terms) {
  const haystack = [resource.title, resource.venue, resource.annotation?.text]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

const rows = [];
for (const testCase of cases) {
  const started = Date.now();
  let result;
  let error;
  try {
    result = await suggestResources(
      { input: testCase.topic, maxResults },
      configFromEnv(),
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ms = Date.now() - started;
  const resources = result?.resources ?? [];
  const terms = (testCase.expect ?? []).map((t) => t.toLowerCase());
  const relevant = resources.filter((r) => relevance(r, terms)).length;
  const formats = [...new Set(resources.map((r) => r.format))];
  const open = resources.filter((r) => r.access === 'open').length;
  rows.push({
    topic: testCase.topic,
    count: resources.length,
    minResources: testCase.minResources ?? 0,
    relevant,
    precision: resources.length ? Number((relevant / resources.length).toFixed(2)) : 0,
    formats,
    open,
    ms,
    error,
  });
}

if (asJson) {
  const totalRelevant = rows.reduce((n, r) => n + r.relevant, 0);
  const totalCount = rows.reduce((n, r) => n + r.count, 0);
  const totalMs = rows.reduce((n, r) => n + r.ms, 0);
  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        maxResults,
        overall: {
          cases: rows.length,
          precision: totalCount ? Number((totalRelevant / totalCount).toFixed(2)) : 0,
          meanLatencyMs: Math.round(totalMs / rows.length),
        },
        rows,
      },
      null,
      2,
    ) + '\n',
  );
} else {
  const header = ['topic', 'n', 'relevant', 'prec', 'formats', 'open', 'ms'];
  const line = (cols) => cols.join(' | ');
  console.log(line(header));
  console.log('-'.repeat(90));
  for (const r of rows) {
    console.log(
      line([
        r.topic.slice(0, 38).padEnd(38),
        String(r.count).padStart(2),
        String(r.relevant).padStart(2),
        r.precision.toFixed(2),
        r.formats.join(',').slice(0, 24).padEnd(24),
        String(r.open).padStart(2),
        String(r.ms).padStart(5),
      ]),
    );
    if (r.error) console.log(`  error: ${r.error}`);
  }
  console.log('-'.repeat(90));
  const totalRelevant = rows.reduce((n, r) => n + r.relevant, 0);
  const totalCount = rows.reduce((n, r) => n + r.count, 0);
  console.log(
    `overall precision ${totalCount ? ((totalRelevant / totalCount) * 100).toFixed(0) : 0}% ` +
      `across ${totalCount} resources; mean latency ` +
      `${Math.round(rows.reduce((n, r) => n + r.ms, 0) / rows.length)}ms`,
  );
}

const failures = rows.filter(
  (r) => r.error || r.count < r.minResources || r.count === 0,
);
if (strict && failures.length) {
  console.error(`\n${failures.length} case(s) below threshold:`);
  for (const r of failures) {
    console.error(`- ${r.topic}: ${r.error ?? `${r.count} < ${r.minResources} resources`}`);
  }
  process.exitCode = 1;
}
