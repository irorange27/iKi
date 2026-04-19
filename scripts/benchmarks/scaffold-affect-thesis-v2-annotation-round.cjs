#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  manifestPath: 'research/affect-thesis-v2/dataset-manifest.v1.jsonl',
  candidatesPath: 'research/affect-thesis-v2/seed-merged/candidate-pool.v1.jsonl',
  outputDir: 'research/affect-thesis-v2',
  roundId: 'formal_v1',
  annotatorIds: ['annotator_a', 'annotator_b'],
  force: false,
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') {
      args.manifestPath = argv[index + 1] ?? args.manifestPath;
      index += 1;
      continue;
    }
    if (arg === '--candidates') {
      args.candidatesPath = argv[index + 1] ?? args.candidatesPath;
      index += 1;
      continue;
    }
    if (arg === '--output-dir') {
      args.outputDir = argv[index + 1] ?? args.outputDir;
      index += 1;
      continue;
    }
    if (arg === '--round-id') {
      args.roundId = argv[index + 1] ?? args.roundId;
      index += 1;
      continue;
    }
    if (arg === '--annotators') {
      const value = argv[index + 1] ?? '';
      args.annotatorIds = value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--force') {
      args.force = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { ...args, help: true };
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.help) {
    if (!args.roundId || !String(args.roundId).trim()) {
      throw new Error('Missing required --round-id');
    }
    if (!Array.isArray(args.annotatorIds) || args.annotatorIds.length < 2) {
      throw new Error('Expected at least 2 annotators via --annotators');
    }
    const dedupedAnnotators = new Set(args.annotatorIds);
    if (dedupedAnnotators.size !== args.annotatorIds.length) {
      throw new Error('Duplicate annotator ids are not allowed');
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function outputPaths(outputDir, roundId, annotatorIds) {
  return {
    worksetPath: path.join(outputDir, `annotation-workset.${roundId}.jsonl`),
    summaryPath: path.join(outputDir, `annotation-round-summary.${roundId}.json`),
    adjudicationPath: path.join(outputDir, `adjudication-log.${roundId}.jsonl`),
    annotationPaths: annotatorIds.map((annotatorId) =>
      path.join(outputDir, `annotation-log.${roundId}.${annotatorId}.jsonl`)
    ),
  };
}

function assertOutputPathAvailable(filePath, force) {
  if (force || !fs.existsSync(filePath)) {
    return;
  }
  throw new Error(
    `Refusing to overwrite existing file without --force: ${filePath}`
  );
}

function buildWorksetRow(manifestRow, candidateRow, roundId) {
  return {
    annotation_packet_id: `annotation_${roundId}_${manifestRow.case_id}`,
    round_id: roundId,
    sample_id: manifestRow.sample_id,
    case_id: manifestRow.case_id,
    candidate_id: candidateRow.candidate_id,
    history: candidateRow.history,
    current_user_message: candidateRow.current_user_message,
    task_context: candidateRow.task_context,
  };
}

function buildAnnotationLogRow(worksetRow, annotatorId) {
  return {
    case_id: worksetRow.case_id,
    sample_id: worksetRow.sample_id,
    candidate_id: worksetRow.candidate_id,
    annotator_id: annotatorId,
    round_id: worksetRow.round_id,
    labels: {
      risk_level: null,
      intervention_state: null,
      escalate: null,
    },
    notes: '',
  };
}

function buildAnnotationRound({ manifestRows, candidateRows, roundId, annotatorIds }) {
  const candidatesById = new Map(candidateRows.map((row) => [row.candidate_id, row]));
  const selectedRows = manifestRows
    .filter((row) => normalizeText(row.selected_candidate_id))
    .sort((left, right) => left.sample_id.localeCompare(right.sample_id, 'zh-Hans-CN'));

  if (selectedRows.length === 0) {
    throw new Error('Manifest does not contain any selected_candidate_id rows');
  }

  const worksetRows = selectedRows.map((manifestRow) => {
    const candidateId = normalizeText(manifestRow.selected_candidate_id);
    const candidateRow = candidatesById.get(candidateId);
    if (!candidateRow) {
      throw new Error(
        `Selected candidate ${candidateId} not found for sample_id=${manifestRow.sample_id}`
      );
    }
    if (normalizeText(candidateRow.sample_id) !== manifestRow.sample_id) {
      throw new Error(
        `Selected candidate ${candidateId} belongs to sample_id=${candidateRow.sample_id}, expected ${manifestRow.sample_id}`
      );
    }
    if (normalizeText(candidateRow.case_id) && normalizeText(candidateRow.case_id) !== manifestRow.case_id) {
      throw new Error(
        `Selected candidate ${candidateId} belongs to case_id=${candidateRow.case_id}, expected ${manifestRow.case_id}`
      );
    }
    return buildWorksetRow(manifestRow, candidateRow, roundId);
  });

  const annotationRowsByAnnotator = Object.fromEntries(
    annotatorIds.map((annotatorId) => [
      annotatorId,
      worksetRows.map((row) => buildAnnotationLogRow(row, annotatorId)),
    ])
  );

  const splitCounts = {};
  for (const row of selectedRows) {
    splitCounts[row.split] = (splitCounts[row.split] ?? 0) + 1;
  }

  return {
    worksetRows,
    annotationRowsByAnnotator,
    summary: {
      round_id: roundId,
      selected_row_count: selectedRows.length,
      annotator_ids: annotatorIds,
      split_counts: splitCounts,
      sample_ids: selectedRows.map((row) => row.sample_id),
    },
  };
}

function printHelp() {
  console.log(`Usage:
node scripts/benchmarks/scaffold-affect-thesis-v2-annotation-round.cjs \\
  --manifest research/affect-thesis-v2/dataset-manifest.v1.jsonl \\
  --candidates research/affect-thesis-v2/seed-merged/candidate-pool.v1.jsonl \\
  --round-id formal_v1 \\
  --annotators annotator_a,annotator_b \\
  --output-dir research/affect-thesis-v2

This command creates:
- annotation-workset.<round-id>.jsonl
- annotation-log.<round-id>.<annotator>.jsonl
- adjudication-log.<round-id>.jsonl
- annotation-round-summary.<round-id>.json

It refuses to overwrite existing files unless --force is provided.`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const manifestRows = loadJsonl(args.manifestPath);
  const candidateRows = loadJsonl(args.candidatesPath);
  const paths = outputPaths(args.outputDir, args.roundId, args.annotatorIds);

  assertOutputPathAvailable(paths.worksetPath, args.force);
  assertOutputPathAvailable(paths.summaryPath, args.force);
  assertOutputPathAvailable(paths.adjudicationPath, args.force);
  for (const annotationPath of paths.annotationPaths) {
    assertOutputPathAvailable(annotationPath, args.force);
  }

  const result = buildAnnotationRound({
    manifestRows,
    candidateRows,
    roundId: args.roundId,
    annotatorIds: args.annotatorIds,
  });

  writeJsonl(paths.worksetPath, result.worksetRows);
  for (const [annotatorId, rows] of Object.entries(result.annotationRowsByAnnotator)) {
    const annotationPath = path.join(
      args.outputDir,
      `annotation-log.${args.roundId}.${annotatorId}.jsonl`
    );
    writeJsonl(annotationPath, rows);
  }
  writeText(paths.adjudicationPath, '');
  writeJson(paths.summaryPath, {
    ...result.summary,
    workset_path: paths.worksetPath,
    annotation_paths: paths.annotationPaths,
    adjudication_path: paths.adjudicationPath,
    manifest_path: args.manifestPath,
    candidates_path: args.candidatesPath,
  });

  console.log(
    JSON.stringify(
      {
        round_id: args.roundId,
        workset_path: paths.worksetPath,
        annotation_paths: paths.annotationPaths,
        adjudication_path: paths.adjudicationPath,
        selected_row_count: result.summary.selected_row_count,
        annotator_ids: args.annotatorIds,
      },
      null,
      2
    )
  );
}

module.exports = {
  DEFAULTS,
  parseArgs,
  outputPaths,
  buildAnnotationRound,
  buildWorksetRow,
  buildAnnotationLogRow,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
