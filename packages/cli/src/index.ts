#!/usr/bin/env node
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import {
  suggestResources,
  suggestBatch,
  toBatchMarkdown,
  recheckResources,
  toRecheckMarkdown,
  configFromEnv,
  toMarkdown,
  toCitations,
  toLmsHtml,
  extract,
  toCollectionFile,
  resourcesFromSaved,
  parseOutcomes,
} from '@michaelborck/honeyguide-core';

function cliVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const program = new Command();

async function readOutcomes(file?: string) {
  if (!file) return [];
  const outcomes = parseOutcomes(await readFile(file, 'utf8'));
  if (!outcomes.length) program.error('No outcomes found in file.');
  return outcomes;
}

program
  .name('honeyguide')
  .description('Finds and verifies supporting resources for your teaching.')
  .version(cliVersion());

program
  .command('suggest')
  .description('List mode: verified, annotated resources for a topic or document')
  .argument('[topic...]', 'topic to find supporting resources for')
  .option('-f, --file <path>', 'read the topic from a document (PDF, DOCX, TXT, MD)')
  .option('-n, --max-results <n>', 'maximum number of resources', '10')
  .option(
    '-o, --format <format>',
    'output format: markdown, json, html (LMS-ready), apa, harvard',
    'markdown',
  )
  .option('--json', 'shorthand for --format json')
  .option('--collection', 'write a portable collection file (JSON) that can be reopened and shared')
  .option('--outcomes <path>', 'align resources to unit outcomes (one per line)')
  .option('-c, --counterpoint', 'also surface material disagreeing with the framing')
  .action(
    async (
      topicWords: string[],
      options: {
        file?: string;
        maxResults: string;
        format: string;
        json?: boolean;
        collection?: boolean;
        outcomes?: string;
        counterpoint?: boolean;
      },
    ) => {
      let input = topicWords.join(' ');
      let label = input;
      if (options.file) {
        const doc = await extract(options.file);
        input = doc.text;
        label = label || path.basename(options.file);
      }
      if (!input.trim()) {
        program.error('Provide a topic or --file <path>.');
      }
      const outcomes = await readOutcomes(options.outcomes);
      const result = await suggestResources(
        {
          input,
          maxResults: Number(options.maxResults),
          counterpoint: Boolean(options.counterpoint),
          ...(outcomes.length ? { outcomes } : {}),
        },
        configFromEnv(),
      );
      const format = options.collection
        ? 'collection'
        : options.json
          ? 'json'
          : options.format;
      let out: string;
      switch (format) {
        case 'collection':
          out = JSON.stringify(toCollectionFile(label, result, outcomes), null, 2);
          break;
        case 'json':
          out = JSON.stringify(result, null, 2);
          break;
        case 'html':
          out = toLmsHtml(label, result);
          break;
        case 'apa':
        case 'harvard':
          out = toCitations(result, format);
          break;
        default:
          out = toMarkdown(label, result);
      }
      process.stdout.write(out + '\n');
    },
  );

program
  .command('batch')
  .description('Batch mode: verified resources for many topics at once (one per line)')
  .argument('<file>', 'text file with one topic per line')
  .option('-n, --max-results <n>', 'maximum resources per topic', '8')
  .option('--outcomes <path>', 'align each topic to unit outcomes (one per line)')
  .option('-c, --counterpoint', 'also surface disagreeing material per topic')
  .option('--json', 'output JSON instead of markdown')
  .action(
    async (
      file: string,
      options: {
        maxResults: string;
        counterpoint?: boolean;
        outcomes?: string;
        json?: boolean;
      },
    ) => {
      const topics = (await readFile(file, 'utf8'))
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
      if (!topics.length) program.error('No topics found in file.');
      const outcomes = await readOutcomes(options.outcomes);
      const entries = await suggestBatch(topics, configFromEnv(), {
        maxResults: Number(options.maxResults),
        counterpoint: Boolean(options.counterpoint),
        ...(outcomes.length ? { outcomes } : {}),
      });
      process.stdout.write(
        (options.json ? JSON.stringify({ entries }, null, 2) : toBatchMarkdown(entries)) +
          '\n',
      );
    },
  );

program
  .command('recheck')
  .description('Link-rot re-run: re-verify a saved collection or JSON result list')
  .argument('<file>', 'collection file, or JSON from `suggest --json` / `batch --json`')
  .option('--json', 'output JSON instead of markdown')
  .action(async (file: string, options: { json?: boolean }) => {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    const resources = resourcesFromSaved(saved);
    if (!resources.length) {
      program.error(
        'No resources found in file — expected a collection, or suggest/batch JSON output.',
      );
    }
    const entries = await recheckResources(resources);
    process.stdout.write(
      (options.json ? JSON.stringify({ entries }, null, 2) : toRecheckMarkdown(entries)) +
        '\n',
    );
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
