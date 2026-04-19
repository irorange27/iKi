#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { validateLabels } = require('./freeze-affect-thesis-v2-dataset.cjs');

const DEFAULTS = {
  manifestPath: 'research/affect-thesis-v2/dataset-manifest.v1.jsonl',
  outputPath: 'research/affect-thesis-v2/dataset-manifest.v1.jsonl',
  summaryPath: 'research/affect-thesis-v2/label-backfill-summary.v1.json',
};

function parseArgs(argv) {
  const args = {
    ...DEFAULTS,
    annotationPaths: [],
    adjudicationPaths: [],
    roundId: null,
    annotationLogRef: null,
    adjudicationLogRef: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') {
      args.manifestPath = argv[index + 1] ?? args.manifestPath;
      index += 1;
      continue;
    }
    if (arg === '--annotations') {
      const value = argv[index + 1] ?? '';
      args.annotationPaths.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (arg === '--adjudications') {
      const value = argv[index + 1] ?? '';
      args.adjudicationPaths.push(
        ...value.split(',').map((entry) => entry.trim()).filter(Boolean)
      );
      index += 1;
      continue;
    }
    if (arg === '--round-id') {
      args.roundId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--annotation-log-ref') {
      args.annotationLogRef = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--adjudication-log-ref') {
      args.adjudicationLogRef = argv[index + 1] ?? null;
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

  if (!args.help && args.annotationPaths.length === 0 && args.adjudicationPaths.length === 0) {
    throw new Error('Missing required --annotations or --adjudications');
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

function normalizeRoundAwareRef(paths, explicitRef) {
  if (explicitRef) return explicitRef;
  if (!Array.isArray(paths) || paths.length === 0) return null;
  return paths.join(',');
}

function labelSignature(labels) {
  return JSON.stringify({
    risk_level: labels.risk_level,
    intervention_state: labels.intervention_state,
    escalate: labels.escalate,
  });
}

function assertRowMatchesManifest(logRow, manifestRow, logType) {
  const sampleId = normalizeText(logRow.sample_id);
  if (sampleId && sampleId !== manifestRow.sample_id) {
    throw new Error(
      `${logType} sample_id mismatch for candidate_id=${logRow.candidate_id}: ${sampleId} != ${manifestRow.sample_id}`
    );
  }
  const caseId = normalizeText(logRow.case_id);
  if (caseId && caseId !== manifestRow.case_id) {
    throw new Error(
      `${logType} case_id mismatch for candidate_id=${logRow.candidate_id}: ${caseId} != ${manifestRow.case_id}`
    );
  }
}

function groupAnnotationRows(rows, { roundId }) {
  const grouped = new Map();
  const seenAnnotatorKeys = new Set();
  let kept = 0;

  for (const row of rows) {
    const rowRoundId = normalizeText(row.round_id);
    if (roundId && rowRoundId && rowRoundId !== roundId) {
      continue;
    }
    const candidateId = normalizeText(row.candidate_id);
    if (!candidateId) {
      throw new Error('Annotation row is missing candidate_id');
    }
    if (!row.labels || typeof row.labels !== 'object' || Array.isArray(row.labels)) {
      throw new Error(`Annotation row for candidate_id=${candidateId} is missing labels`);
    }
    validateLabels(row.labels, { sample_id: normalizeText(row.sample_id) || '(annotation log)' });
    const annotatorId = normalizeText(row.annotator_id);
    if (!annotatorId) {
      throw new Error(`Annotation row for candidate_id=${candidateId} is missing annotator_id`);
    }
    const dedupeKey = `${candidateId}::${annotatorId}`;
    if (seenAnnotatorKeys.has(dedupeKey)) {
      throw new Error(
        `Duplicate annotation row for candidate_id=${candidateId} annotator_id=${annotatorId}`
      );
    }
    seenAnnotatorKeys.add(dedupeKey);
    const bucket = grouped.get(candidateId) ?? [];
    bucket.push(row);
    grouped.set(candidateId, bucket);
    kept += 1;
  }

  return { grouped, kept };
}

function groupAdjudicationRows(rows, { roundId }) {
  const grouped = new Map();
  let kept = 0;

  for (const row of rows) {
    const rowRoundId = normalizeText(row.round_id);
    if (roundId && rowRoundId && rowRoundId !== roundId) {
      continue;
    }
    const candidateId = normalizeText(row.candidate_id);
    if (!candidateId) {
      throw new Error('Adjudication row is missing candidate_id');
    }
    if (!row.final_labels || typeof row.final_labels !== 'object' || Array.isArray(row.final_labels)) {
      throw new Error(`Adjudication row for candidate_id=${candidateId} is missing final_labels`);
    }
    validateLabels(row.final_labels, {
      sample_id: normalizeText(row.sample_id) || '(adjudication log)',
    });
    if (grouped.has(candidateId)) {
      throw new Error(`Duplicate adjudication row for candidate_id=${candidateId}`);
    }
    grouped.set(candidateId, row);
    kept += 1;
  }

  return { grouped, kept };
}

function deriveConsensusLabels(annotationRows) {
  if (annotationRows.length < 2) {
    return null;
  }
  const signatures = new Set(annotationRows.map((row) => labelSignature(row.labels)));
  if (signatures.size !== 1) {
    return null;
  }
  return annotationRows[0].labels;
}

function buildConsensusNote(annotationRows) {
  return `由 ${annotationRows.length} 位标注者一致给出，无需裁决。`;
}

function summarizeRowState(row, summary) {
  const annotationStatus = normalizeText(row.annotation_status);
  const adjudicationStatus = normalizeText(row.adjudication_status);

  if (annotationStatus === 'partial') {
    summary.rows_with_partial_annotation += 1;
    summary.rows_pending_annotation += 1;
    return;
  }

  if (annotationStatus !== 'complete') {
    summary.rows_pending_annotation += 1;
    return;
  }

  if (adjudicationStatus === 'pending') {
    summary.rows_pending_adjudication += 1;
  }
}

function backfillManifestLabels({
  manifestRows,
  annotationRows,
  adjudicationRows,
  roundId = null,
  annotationLogRef = null,
  adjudicationLogRef = null,
}) {
  const { grouped: annotationByCandidateId, kept: keptAnnotationCount } = groupAnnotationRows(
    annotationRows,
    { roundId }
  );
  const { grouped: adjudicationByCandidateId, kept: keptAdjudicationCount } =
    groupAdjudicationRows(adjudicationRows, { roundId });

  const summary = {
    round_id: roundId,
    total_manifest_rows: manifestRows.length,
    selected_rows: 0,
    annotation_rows_used: keptAnnotationCount,
    adjudication_rows_used: keptAdjudicationCount,
    rows_backfilled: 0,
    rows_backfilled_from_consensus: 0,
    rows_backfilled_from_adjudication: 0,
    rows_pending_annotation: 0,
    rows_pending_adjudication: 0,
    rows_with_partial_annotation: 0,
    updated_sample_ids: [],
  };

  const updatedRows = manifestRows.map((row) => {
    const candidateId = normalizeText(row.selected_candidate_id);
    if (!candidateId) {
      return row;
    }

    summary.selected_rows += 1;

    const annotations = annotationByCandidateId.get(candidateId) ?? [];
    const adjudication = adjudicationByCandidateId.get(candidateId) ?? null;

    annotations.forEach((annotationRow) => assertRowMatchesManifest(annotationRow, row, 'annotation'));
    if (adjudication) {
      assertRowMatchesManifest(adjudication, row, 'adjudication');
    }

    const nextRow = { ...row };

    if (annotations.length === 0 && !adjudication) {
      summarizeRowState(nextRow, summary);
      return nextRow;
    }

    if (annotations.length < 2 && !adjudication) {
      nextRow.annotation_status = 'partial';
      nextRow.adjudication_status = 'pending';
      summary.rows_with_partial_annotation += 1;
      summary.rows_pending_annotation += 1;
      if (nextRow.final_labels) {
        throw new Error(
          `Manifest row sample_id=${row.sample_id} already has final_labels but only ${annotations.length} annotation row(s) were provided`
        );
      }
      return nextRow;
    }

    if (adjudication) {
      nextRow.annotation_status = annotations.length >= 2 ? 'complete' : 'partial';
      nextRow.adjudication_status = 'resolved';
      nextRow.final_labels = adjudication.final_labels;
      nextRow.final_label_notes =
        normalizeText(adjudication.manifest_update?.final_label_notes) ||
        normalizeText(adjudication.reason) ||
        normalizeText(row.final_label_notes) ||
        null;
      nextRow.annotation_log_ref =
        normalizeText(adjudication.manifest_update?.annotation_log_ref) ||
        annotationLogRef ||
        nextRow.annotation_log_ref ||
        null;
      nextRow.adjudication_log_ref =
        normalizeText(adjudication.manifest_update?.adjudication_log_ref) ||
        adjudicationLogRef ||
        nextRow.adjudication_log_ref ||
        null;
      summary.rows_backfilled += 1;
      summary.rows_backfilled_from_adjudication += 1;
      summary.updated_sample_ids.push(row.sample_id);
      return nextRow;
    }

    const consensusLabels = deriveConsensusLabels(annotations);
    if (!consensusLabels) {
      nextRow.annotation_status = 'complete';
      nextRow.adjudication_status = 'pending';
      summary.rows_pending_adjudication += 1;
      if (nextRow.final_labels) {
        throw new Error(
          `Manifest row sample_id=${row.sample_id} still has conflicting annotations but already contains final_labels`
        );
      }
      return nextRow;
    }

    nextRow.annotation_status = 'complete';
    nextRow.adjudication_status = 'not_required';
    nextRow.final_labels = {
      risk_level: consensusLabels.risk_level,
      intervention_state: consensusLabels.intervention_state,
      escalate: consensusLabels.escalate,
      rationale: normalizeText(nextRow.final_labels?.rationale) || null,
    };
    nextRow.final_label_notes = buildConsensusNote(annotations);
    nextRow.annotation_log_ref = annotationLogRef || nextRow.annotation_log_ref || null;
    nextRow.adjudication_log_ref = null;
    summary.rows_backfilled += 1;
    summary.rows_backfilled_from_consensus += 1;
    summary.updated_sample_ids.push(row.sample_id);
    return nextRow;
  });

  return {
    rows: updatedRows,
    summary,
  };
}

function printHelp() {
  console.log(`Usage:
node scripts/benchmarks/backfill-affect-thesis-v2-manifest-labels.cjs \\
  --manifest research/affect-thesis-v2/dataset-manifest.v1.jsonl \\
  --annotations research/affect-thesis-v2/annotation-log.formal_v1.jsonl \\
  --adjudications research/affect-thesis-v2/adjudication-log.formal_v1.jsonl \\
  --round-id formal_v1 \\
  --output research/affect-thesis-v2/dataset-manifest.v1.jsonl \\
  --summary research/affect-thesis-v2/label-backfill-summary.v1.json`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const manifestRows = loadJsonl(args.manifestPath);
  const annotationRows = args.annotationPaths.flatMap((filePath) => loadJsonl(filePath));
  const adjudicationRows = args.adjudicationPaths.flatMap((filePath) => loadJsonl(filePath));
  const annotationLogRef = normalizeRoundAwareRef(args.annotationPaths, args.annotationLogRef);
  const adjudicationLogRef = normalizeRoundAwareRef(
    args.adjudicationPaths,
    args.adjudicationLogRef
  );
  const result = backfillManifestLabels({
    manifestRows,
    annotationRows,
    adjudicationRows,
    roundId: args.roundId,
    annotationLogRef,
    adjudicationLogRef,
  });

  writeJsonl(args.outputPath, result.rows);
  writeJson(args.summaryPath, result.summary);

  console.log(
    JSON.stringify(
      {
        output_path: args.outputPath,
        summary_path: args.summaryPath,
        rows_backfilled: result.summary.rows_backfilled,
        rows_pending_annotation: result.summary.rows_pending_annotation,
        rows_pending_adjudication: result.summary.rows_pending_adjudication,
      },
      null,
      2
    )
  );
}

module.exports = {
  DEFAULTS,
  parseArgs,
  deriveConsensusLabels,
  backfillManifestLabels,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
