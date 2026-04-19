#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  manifestPath: 'research/affect-thesis-v2/dataset-manifest.v1.jsonl',
  outputPath: 'research/affect-thesis-v2/dataset-manifest.v1.jsonl',
  summaryPath: 'research/affect-thesis-v2/selection-backfill-summary.v1.json',
};

function parseArgs(argv) {
  const args = {
    ...DEFAULTS,
    selectionsPath: null,
    candidatesPath: null,
    auditPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') {
      args.manifestPath = argv[index + 1] ?? args.manifestPath;
      index += 1;
      continue;
    }
    if (arg === '--selections') {
      args.selectionsPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--candidates') {
      args.candidatesPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--audit') {
      args.auditPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--output') {
      args.outputPath = argv[index + 1] ?? args.outputPath;
      index += 1;
      continue;
    }
    if (arg === '--summary') {
      args.summaryPath = argv[index + 1] ?? args.summaryPath;
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { ...args, help: true };
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.help) {
    if (!args.selectionsPath) throw new Error('Missing required --selections');
    if (!args.candidatesPath) throw new Error('Missing required --candidates');
    if (!args.auditPath) throw new Error('Missing required --audit');
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

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalizeText(entry)).filter(Boolean);
}

function validateSelectionRow(row) {
  const sampleId = normalizeText(row.sample_id);
  const selectedCandidateId = normalizeText(row.selected_candidate_id);
  const selectedCandidateNotes = normalizeText(row.selected_candidate_notes);
  const rejectedCandidateIds = normalizeIdList(row.rejected_candidate_ids);

  if (!sampleId) {
    throw new Error('Selection row is missing sample_id');
  }
  if (!selectedCandidateId) {
    throw new Error(`Selection row sample_id=${sampleId} is missing selected_candidate_id`);
  }
  if (!selectedCandidateNotes) {
    throw new Error(`Selection row sample_id=${sampleId} is missing selected_candidate_notes`);
  }
  if (rejectedCandidateIds.includes(selectedCandidateId)) {
    throw new Error(
      `Selection row sample_id=${sampleId} includes selected_candidate_id in rejected_candidate_ids`
    );
  }

  return {
    sample_id: sampleId,
    selected_candidate_id: selectedCandidateId,
    selected_candidate_notes: selectedCandidateNotes,
    rejected_candidate_ids: rejectedCandidateIds,
  };
}

function backfillManifestSelections({ manifestRows, selectionRows, candidateRows, auditRows }) {
  const manifestBySampleId = new Map(manifestRows.map((row) => [row.sample_id, row]));
  const candidatesById = new Map(candidateRows.map((row) => [row.candidate_id, row]));
  const auditByCandidateId = new Map(auditRows.map((row) => [row.candidate_id, row]));
  const seenSampleIds = new Set();

  const normalizedSelections = selectionRows.map(validateSelectionRow);
  for (const selection of normalizedSelections) {
    if (seenSampleIds.has(selection.sample_id)) {
      throw new Error(`Duplicate selection row for sample_id=${selection.sample_id}`);
    }
    seenSampleIds.add(selection.sample_id);
    const manifestRow = manifestBySampleId.get(selection.sample_id);
    if (!manifestRow) {
      throw new Error(`Selection row references unknown sample_id=${selection.sample_id}`);
    }
    const selectedCandidate = candidatesById.get(selection.selected_candidate_id);
    if (!selectedCandidate) {
      throw new Error(
        `Selected candidate ${selection.selected_candidate_id} not found for sample_id=${selection.sample_id}`
      );
    }
    if (normalizeText(selectedCandidate.sample_id) !== selection.sample_id) {
      throw new Error(
        `Selected candidate ${selection.selected_candidate_id} belongs to sample_id=${selectedCandidate.sample_id}, expected ${selection.sample_id}`
      );
    }
    const audit = auditByCandidateId.get(selection.selected_candidate_id);
    if (!audit || audit.status !== 'pass') {
      throw new Error(
        `Selected candidate ${selection.selected_candidate_id} for sample_id=${selection.sample_id} did not pass audit`
      );
    }
    for (const rejectedCandidateId of selection.rejected_candidate_ids) {
      const rejectedCandidate = candidatesById.get(rejectedCandidateId);
      if (!rejectedCandidate) {
        throw new Error(
          `Rejected candidate ${rejectedCandidateId} not found for sample_id=${selection.sample_id}`
        );
      }
      if (normalizeText(rejectedCandidate.sample_id) !== selection.sample_id) {
        throw new Error(
          `Rejected candidate ${rejectedCandidateId} belongs to sample_id=${rejectedCandidate.sample_id}, expected ${selection.sample_id}`
        );
      }
    }
  }

  const updatedRows = manifestRows.map((row) => {
    const selection = normalizedSelections.find((entry) => entry.sample_id === row.sample_id);
    if (!selection) return row;
    return {
      ...row,
      draft_status: 'candidate_selected',
      candidate_status: 'selected',
      audit_status: 'pass',
      selected_candidate_id: selection.selected_candidate_id,
      selected_candidate_notes: selection.selected_candidate_notes,
    };
  });

  const summary = {
    total_manifest_rows: manifestRows.length,
    total_selection_rows: normalizedSelections.length,
    updated_rows: normalizedSelections.length,
    selected_sample_ids: normalizedSelections.map((entry) => entry.sample_id),
    missing_selection_sample_ids: manifestRows
      .filter((row) => !seenSampleIds.has(row.sample_id))
      .map((row) => row.sample_id),
  };

  return {
    rows: updatedRows,
    summary,
  };
}

function printHelp() {
  console.log(`Usage:
node scripts/benchmarks/backfill-affect-thesis-v2-manifest-selections.cjs \\
  --manifest research/affect-thesis-v2/dataset-manifest.v1.jsonl \\
  --selections research/affect-thesis-v2/selection-log.v1.jsonl \\
  --candidates research/affect-thesis-v2/seed-merged/candidate-pool.v1.jsonl \\
  --audit research/affect-thesis-v2/seed-merged/audits/candidate-audit.v1.jsonl \\
  --output research/affect-thesis-v2/dataset-manifest.v1.jsonl \\
  --summary research/affect-thesis-v2/selection-backfill-summary.v1.json`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const manifestRows = loadJsonl(args.manifestPath);
  const selectionRows = loadJsonl(args.selectionsPath);
  const candidateRows = loadJsonl(args.candidatesPath);
  const auditRows = loadJsonl(args.auditPath);
  const result = backfillManifestSelections({
    manifestRows,
    selectionRows,
    candidateRows,
    auditRows,
  });

  writeJsonl(args.outputPath, result.rows);
  writeJson(args.summaryPath, result.summary);

  console.log(
    JSON.stringify(
      {
        output_path: args.outputPath,
        summary_path: args.summaryPath,
        updated_rows: result.summary.updated_rows,
        missing_selection_rows: result.summary.missing_selection_sample_ids.length,
      },
      null,
      2
    )
  );
}

module.exports = {
  DEFAULTS,
  parseArgs,
  validateSelectionRow,
  backfillManifestSelections,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
