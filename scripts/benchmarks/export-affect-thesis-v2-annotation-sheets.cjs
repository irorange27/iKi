#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
  normalizeText,
  formatHistoryForSheet,
  formatConstraintsForSheet,
  stringifyCsv,
} = require('./annotation-sheet-csv-utils.cjs');

const DEFAULTS = {
  worksetPath: null,
  outputDir: 'research/affect-thesis-v2',
};

const SHEET_HEADERS = [
  'annotator_id',
  'round_id',
  'case_id',
  'sample_id',
  'candidate_id',
  'history_text',
  'current_user_message',
  'task_goal',
  'task_deliverable',
  'task_constraints',
  'risk_level',
  'intervention_state',
  'escalate',
  'notes',
];

function parseArgs(argv) {
  const args = {
    ...DEFAULTS,
    annotationPaths: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workset') {
      args.worksetPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--annotations') {
      const value = argv[index + 1] ?? '';
      args.annotationPaths.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (arg === '--output-dir') {
      args.outputDir = argv[index + 1] ?? args.outputDir;
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { ...args, help: true };
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.help) {
    if (!args.worksetPath) throw new Error('Missing required --workset');
    if (args.annotationPaths.length === 0) throw new Error('Missing required --annotations');
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

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function inferSheetPath(outputDir, annotationPath) {
  const fileName = path.basename(annotationPath).replace(/^annotation-log\./, 'annotation-sheet.');
  return path.join(outputDir, fileName.replace(/\.jsonl$/, '.csv'));
}

function buildSheetRows(worksetRows, annotationRows) {
  const worksetByCandidateId = new Map(worksetRows.map((row) => [row.candidate_id, row]));
  return annotationRows.map((annotationRow) => {
    const worksetRow = worksetByCandidateId.get(annotationRow.candidate_id);
    if (!worksetRow) {
      throw new Error(
        `Annotation row candidate_id=${annotationRow.candidate_id} not found in workset`
      );
    }
    return {
      annotator_id: annotationRow.annotator_id,
      round_id: annotationRow.round_id,
      case_id: annotationRow.case_id,
      sample_id: annotationRow.sample_id,
      candidate_id: annotationRow.candidate_id,
      history_text: formatHistoryForSheet(worksetRow.history),
      current_user_message: normalizeText(worksetRow.current_user_message),
      task_goal: normalizeText(worksetRow.task_context?.goal),
      task_deliverable: normalizeText(worksetRow.task_context?.deliverable),
      task_constraints: formatConstraintsForSheet(worksetRow.task_context?.constraints),
      risk_level: annotationRow.labels?.risk_level ?? '',
      intervention_state: annotationRow.labels?.intervention_state ?? '',
      escalate:
        annotationRow.labels?.escalate === 0 || annotationRow.labels?.escalate === 1
          ? String(annotationRow.labels.escalate)
          : '',
      notes: annotationRow.notes ?? '',
    };
  });
}

function printHelp() {
  console.log(`Usage:
node scripts/benchmarks/export-affect-thesis-v2-annotation-sheets.cjs \\
  --workset research/affect-thesis-v2/annotation-workset.formal_v2.jsonl \\
  --annotations research/affect-thesis-v2/annotation-log.formal_v2.annotator_a.jsonl,research/affect-thesis-v2/annotation-log.formal_v2.annotator_b.jsonl \\
  --output-dir research/affect-thesis-v2`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const worksetRows = loadJsonl(args.worksetPath);
  const outputs = [];

  for (const annotationPath of args.annotationPaths) {
    const annotationRows = loadJsonl(annotationPath);
    const sheetRows = buildSheetRows(worksetRows, annotationRows);
    const outputPath = inferSheetPath(args.outputDir, annotationPath);
    writeText(outputPath, stringifyCsv(sheetRows, SHEET_HEADERS, { bom: true }));
    outputs.push({
      annotation_path: annotationPath,
      sheet_path: outputPath,
      row_count: sheetRows.length,
    });
  }

  console.log(
    JSON.stringify(
      {
        workset_path: args.worksetPath,
        outputs,
      },
      null,
      2
    )
  );
}

module.exports = {
  DEFAULTS,
  SHEET_HEADERS,
  parseArgs,
  inferSheetPath,
  buildSheetRows,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
