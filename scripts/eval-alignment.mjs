#!/usr/bin/env node
/**
 * Hand-labelled evaluation of outcome alignment (docs/plan-bigger-bets.md,
 * Bet 1 milestone 4).
 *
 * Runs the configured local aligner against eval/alignment-set.json and
 * reports correctness, false positives, missed outcomes and abstentions.
 * Network/local-model dependent, so it is a manual tool; `--strict` exits
 * non-zero when accuracy drops below the threshold.
 *
 * Usage:
 *   DECISION_URL=http://localhost:11434 npm run eval:alignment
 *   DECISION_URL=http://localhost:11434 npm run eval:alignment -- --json
 *   DECISION_URL=http://localhost:11434 npm run eval:alignment -- --strict
 */
import { readFile } from 'node:fs/promises';
import {
  configFromEnv,
  createOutcomeAligner,
} from '../packages/core/dist/index.js';

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const strict = args.has('--strict');
const MIN_ACCURACY = 0.8;

const cases = JSON.parse(
  await readFile(new URL('../eval/alignment-set.json', import.meta.url), 'utf8'),
);
const config = configFromEnv();
const aligner = createOutcomeAligner(config);
if (!aligner) {
  console.error(
    'No alignment model configured. Set DECISION_URL (preferred) or EMBEDDING_URL.',
  );
  process.exit(1);
}

const rows = [];
const caseSummaries = [];

for (const testCase of cases) {
  const resources = testCase.resources.map((r, index) => ({
    stance: 'supporting',
    title: r.title,
    url: `https://example.org/${encodeURIComponent(testCase.name)}/${index}`,
    format: r.format ?? 'paper',
    sourceType: 'peer-reviewed',
    authors: [],
    year: r.year ?? 2024,
    venue: r.venue ?? null,
    verification: 'verified',
    verificationBasis: 'database',
    access: 'unknown',
    commerciallyInterested: false,
    licensing: 'unknown',
    annotation: { source: 'extracted', text: r.description ?? null },
    thumbnailUrl: null,
    accessibilityNotes: [],
    alignment: null,
  }));

  const started = Date.now();
  let alignments = new Map();
  let error;
  try {
    alignments = await aligner.align(testCase.topic, resources, testCase.outcomes);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ms = Date.now() - started;
  caseSummaries.push({ name: testCase.name, ms, error });

  resources.forEach((resource, index) => {
    const expected = testCase.resources[index].expected ?? null;
    const alignment = alignments.get(resource) ?? null;
    const got = alignment?.outcomeId ?? null;
    let result;
    if (error) result = 'error';
    else if (got === expected) result = expected ? 'correct' : 'correct-abstain';
    else if (expected === null) result = 'false-positive';
    else if (got === null) result = 'missed';
    else result = 'wrong';
    rows.push({
      case: testCase.name,
      title: resource.title,
      expected,
      got,
      result,
      confidence: alignment?.confidence ?? null,
      score: alignment?.score ?? null,
    });
  });
}

const total = rows.length;
const count = (result) => rows.filter((row) => row.result === result).length;
const correct = count('correct');
const correctAbstain = count('correct-abstain');
const wrong = count('wrong');
const missed = count('missed');
const falsePositive = count('false-positive');
const errors = count('error');
const expectedNull = rows.filter((row) => row.expected === null).length;
const answerable = total - expectedNull;
const accuracy = total ? (correct + correctAbstain) / total : 0;
const precision = correct + wrong + falsePositive ? correct / (correct + wrong + falsePositive) : 0;
const recall = answerable ? correct / answerable : 0;
const abstainAccuracy = expectedNull ? correctAbstain / expectedNull : 1;
const meanLatency = Math.round(
  caseSummaries.reduce((sum, item) => sum + item.ms, 0) / caseSummaries.length,
);

const overall = {
  backend: aligner.name,
  model: config.decisionModel ?? config.embeddingModel ?? null,
  cases: cases.length,
  resources: total,
  correct,
  correctAbstain,
  wrong,
  missed,
  falsePositive,
  errors,
  accuracy: Number(accuracy.toFixed(3)),
  precision: Number(precision.toFixed(3)),
  recall: Number(recall.toFixed(3)),
  abstainAccuracy: Number(abstainAccuracy.toFixed(3)),
  meanLatencyMs: meanLatency,
};

if (asJson) {
  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        overall,
        cases: caseSummaries,
        rows,
      },
      null,
      2,
    ) + '\n',
  );
} else {
  console.log(`aligner: ${aligner.name}${overall.model ? ` (${overall.model})` : ''}`);
  console.log('');
  const header = ['case', 'resource', 'expected', 'got', 'result', 'conf', 'score'];
  console.log(header.join(' | '));
  console.log('-'.repeat(110));
  for (const row of rows) {
    console.log(
      [
        row.case.slice(0, 14).padEnd(14),
        row.title.slice(0, 40).padEnd(40),
        String(row.expected ?? 'none').padEnd(8),
        String(row.got ?? 'none').padEnd(8),
        row.result.padEnd(15),
        String(row.confidence ?? '-').padEnd(6),
        row.score === null ? '-' : row.score.toFixed(2),
      ].join(' | '),
    );
  }
  console.log('-'.repeat(110));
  console.log(
    `accuracy ${(accuracy * 100).toFixed(0)}% (${correct + correctAbstain}/${total}) · ` +
      `precision ${(precision * 100).toFixed(0)}% · recall ${(recall * 100).toFixed(0)}% · ` +
      `abstain ${(abstainAccuracy * 100).toFixed(0)}% · mean ${meanLatency}ms`,
  );
  console.log(
    `correct ${correct} · correct-abstain ${correctAbstain} · wrong ${wrong} · ` +
      `missed ${missed} · false-positive ${falsePositive} · errors ${errors}`,
  );
  for (const item of caseSummaries) {
    if (item.error) console.log(`error in ${item.name}: ${item.error}`);
  }
}

if (strict && (accuracy < MIN_ACCURACY || errors > 0)) {
  console.error(
    `\nStrict mode: accuracy ${(accuracy * 100).toFixed(0)}% is below ` +
      `${(MIN_ACCURACY * 100).toFixed(0)}%${errors ? `, or ${errors} error(s)` : ''}.`,
  );
  process.exitCode = 1;
}
