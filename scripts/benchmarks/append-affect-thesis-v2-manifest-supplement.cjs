#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
  buildMainRows,
  buildNeutralRows,
  buildManifestSummary,
} = require('./scaffold-affect-thesis-v2-manifest.cjs');

const DEFAULTS = {
  manifestPath: 'research/affect-thesis-v2/dataset-manifest.v1.jsonl',
  summaryPath: 'research/affect-thesis-v2/manifest-summary.v1.json',
  outputPath: 'research/affect-thesis-v2/dataset-manifest.v1.jsonl',
};

function parseArgs(argv) {
  const args = {
    ...DEFAULTS,
    blueprintPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') {
      args.manifestPath = argv[index + 1] ?? args.manifestPath;
      index += 1;
      continue;
    }
    if (arg === '--blueprint') {
      args.blueprintPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--summary') {
      args.summaryPath = argv[index + 1] ?? args.summaryPath;
      index += 1;
      continue;
    }
    if (arg === '--output') {
      args.outputPath = argv[index + 1] ?? args.outputPath;
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { ...args, help: true };
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.help && !args.blueprintPath) {
    throw new Error('Missing required --blueprint');
  }

  return args;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadJsonl(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function parseNumericSuffix(value, pattern) {
  const match = String(value).match(pattern);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

function findMaxIndex(rows, split) {
  const pattern =
    split === 'main_affect'
      ? /^manifest_thesis_main_v2_(\d+)$/
      : /^manifest_thesis_neutral_v2_(\d+)$/;
  let max = 0;
  for (const row of rows) {
    if (row.split !== split) continue;
    const numeric = parseNumericSuffix(row.sample_id, pattern);
    if (numeric && numeric > max) {
      max = numeric;
    }
  }
  return max;
}

function mergeBlueprintPaths(existingSummary, supplementBlueprintPath) {
  const prior = Array.isArray(existingSummary?.blueprint_paths)
    ? existingSummary.blueprint_paths
    : existingSummary?.blueprint_path
      ? [existingSummary.blueprint_path]
      : [];
  return [...new Set([...prior, supplementBlueprintPath].filter(Boolean))];
}

function appendManifestSupplement({ manifestRows, supplementBlueprint }) {
  const nextMainIndex = findMaxIndex(manifestRows, 'main_affect');
  const nextNeutralIndex = findMaxIndex(manifestRows, 'neutral_control');
  const supplementMainRows =
    Array.isArray(supplementBlueprint.main_affect?.variants) &&
    supplementBlueprint.main_affect.variants.length > 0 &&
    Array.isArray(supplementBlueprint.main_affect?.base_tasks) &&
    supplementBlueprint.main_affect.base_tasks.length > 0
      ? buildMainRows(supplementBlueprint, nextMainIndex)
      : [];
  const supplementNeutralRows =
    Array.isArray(supplementBlueprint.neutral_control?.tasks) &&
    supplementBlueprint.neutral_control.tasks.length > 0
      ? buildNeutralRows(supplementBlueprint, nextNeutralIndex)
      : [];
  const appendedRows = [...supplementMainRows, ...supplementNeutralRows];

  if (appendedRows.length === 0) {
    throw new Error('Supplement blueprint did not produce any rows');
  }

  const sampleIds = new Set(manifestRows.map((row) => row.sample_id));
  const caseIds = new Set(manifestRows.map((row) => row.case_id));
  for (const row of appendedRows) {
    if (sampleIds.has(row.sample_id)) {
      throw new Error(`Duplicate sample_id when appending manifest: ${row.sample_id}`);
    }
    if (caseIds.has(row.case_id)) {
      throw new Error(`Duplicate case_id when appending manifest: ${row.case_id}`);
    }
    sampleIds.add(row.sample_id);
    caseIds.add(row.case_id);
  }

  return {
    rows: [...manifestRows, ...appendedRows],
    appendedRows,
  };
}

function printHelp() {
  console.log(`Usage:
node scripts/benchmarks/append-affect-thesis-v2-manifest-supplement.cjs \\
  --manifest research/affect-thesis-v2/dataset-manifest.v1.jsonl \\
  --blueprint research/affect-thesis-v2/blueprint.neutral-balance-supplement.v1.json \\
  --summary research/affect-thesis-v2/manifest-summary.v1.json \\
  --output research/affect-thesis-v2/dataset-manifest.v1.jsonl`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const manifestRows = loadJsonl(args.manifestPath);
  const supplementBlueprint = loadJson(args.blueprintPath);
  const existingSummary = fs.existsSync(args.summaryPath) ? loadJson(args.summaryPath) : null;
  const result = appendManifestSupplement({ manifestRows, supplementBlueprint });
  const blueprintPaths = mergeBlueprintPaths(existingSummary, args.blueprintPath);
  const summary = buildManifestSummary(result.rows, blueprintPaths);

  writeJsonl(args.outputPath, result.rows);
  writeJson(args.summaryPath, summary);

  console.log(
    JSON.stringify(
      {
        output_path: args.outputPath,
        summary_path: args.summaryPath,
        appended_rows: result.appendedRows.length,
        total_rows: result.rows.length,
        sample_ids: result.appendedRows.map((row) => row.sample_id),
      },
      null,
      2
    )
  );
}

module.exports = {
  DEFAULTS,
  parseArgs,
  findMaxIndex,
  appendManifestSupplement,
  mergeBlueprintPaths,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
