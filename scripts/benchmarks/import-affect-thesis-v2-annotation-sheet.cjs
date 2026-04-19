#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
  normalizeText,
  parseCsv,
  validateSheetLabels,
} = require('./annotation-sheet-csv-utils.cjs');

const DEFAULTS = {
  outputPath: null,
};

function parseArgs(argv) {
  const args = {
    ...DEFAULTS,
    sheetPath: null,
    templatePath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--sheet') {
      args.sheetPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--template') {
      args.templatePath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--output') {
      args.outputPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { ...args, help: true };
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.help) {
    if (!args.sheetPath) throw new Error('Missing required --sheet');
    if (!args.templatePath) throw new Error('Missing required --template');
    if (!args.outputPath) {
      args.outputPath = args.templatePath;
    }
  }

  return args;
}

function loadJsonl(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function buildRowKey(row) {
  return [
    normalizeText(row.annotator_id),
    normalizeText(row.round_id),
    normalizeText(row.case_id),
    normalizeText(row.sample_id),
    normalizeText(row.candidate_id),
  ].join('::');
}

function importAnnotationSheet({ templateRows, sheetRows }) {
  const sheetByKey = new Map();
  for (const sheetRow of sheetRows) {
    const key = buildRowKey(sheetRow);
    if (sheetByKey.has(key)) {
      throw new Error(`Duplicate sheet row for key=${key}`);
    }
    sheetByKey.set(key, sheetRow);
  }

  const updatedRows = templateRows.map((templateRow) => {
    const key = buildRowKey(templateRow);
    const sheetRow = sheetByKey.get(key);
    if (!sheetRow) {
      throw new Error(`Sheet is missing row for key=${key}`);
    }
    const labels = validateSheetLabels(sheetRow, { allowPartial: true });
    return {
      ...templateRow,
      labels: {
        risk_level: labels.risk_level,
        intervention_state: labels.intervention_state,
        escalate: labels.escalate,
      },
      notes: sheetRow.notes ?? '',
    };
  });

  return {
    rows: updatedRows,
    summary: {
      total_rows: updatedRows.length,
      completed_rows: updatedRows.filter(
        (row) =>
          row.labels.risk_level &&
          row.labels.intervention_state &&
          (row.labels.escalate === 0 || row.labels.escalate === 1)
      ).length,
      blank_rows: updatedRows.filter(
        (row) =>
          !row.labels.risk_level &&
          !row.labels.intervention_state &&
          row.labels.escalate == null &&
          !normalizeText(row.notes)
      ).length,
    },
  };
}

function printHelp() {
  console.log(`Usage:
node scripts/benchmarks/import-affect-thesis-v2-annotation-sheet.cjs \\
  --sheet research/affect-thesis-v2/annotation-sheet.formal_v2.annotator_a.csv \\
  --template research/affect-thesis-v2/annotation-log.formal_v2.annotator_a.jsonl \\
  --output research/affect-thesis-v2/annotation-log.formal_v2.annotator_a.jsonl`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const templateRows = loadJsonl(args.templatePath);
  const sheetRows = parseCsv(fs.readFileSync(args.sheetPath, 'utf8'));
  const result = importAnnotationSheet({ templateRows, sheetRows });
  writeJsonl(args.outputPath, result.rows);

  console.log(
    JSON.stringify(
      {
        sheet_path: args.sheetPath,
        template_path: args.templatePath,
        output_path: args.outputPath,
        ...result.summary,
      },
      null,
      2
    )
  );
}

module.exports = {
  DEFAULTS,
  parseArgs,
  buildRowKey,
  importAnnotationSheet,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
