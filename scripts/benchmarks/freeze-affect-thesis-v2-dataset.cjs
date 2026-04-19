#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  manifestPath: 'research/affect-thesis-v2/dataset-manifest.v1.jsonl',
  outputDir: 'research/affect-thesis-v2/frozen',
};

const VALID_RISK_LEVELS = new Set(['low', 'medium', 'high']);
const VALID_INTERVENTION_STATES = new Set([
  'stabilize',
  'clarify',
  'co_plan',
  'guided_execute',
  'autonomous_execute',
]);

function parseArgs(argv) {
  const args = {
    ...DEFAULTS,
    candidatesPath: null,
    auditPath: null,
    allowPartial: false,
    allowExpectedLabels: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') {
      args.manifestPath = argv[index + 1] ?? args.manifestPath;
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
    if (arg === '--output-dir') {
      args.outputDir = argv[index + 1] ?? args.outputDir;
      index += 1;
      continue;
    }
    if (arg === '--allow-partial') {
      args.allowPartial = true;
      continue;
    }
    if (arg === '--allow-expected-labels') {
      args.allowExpectedLabels = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { ...args, help: true };
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.help) {
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveFinalLabels(row, { allowExpectedLabels }) {
  if (row.final_labels && typeof row.final_labels === 'object' && !Array.isArray(row.final_labels)) {
    return {
      labelSource: 'final_labels',
      labels: row.final_labels,
    };
  }
  if (allowExpectedLabels) {
    return {
      labelSource: 'expected_label_tendency',
      labels: {
        risk_level: row.expected_label_tendency?.risk_level,
        intervention_state: row.expected_label_tendency?.intervention_state,
        escalate: row.expected_label_tendency?.escalate,
        rationale:
          row.expected_label_tendency?.rationale ??
          row.expected_label_tendency?.rationale_stub ??
          null,
      },
    };
  }
  throw new Error(
    `Missing final_labels for sample_id=${row.sample_id}; thesis freeze should use adjudicated labels, not expected_label_tendency`
  );
}

function validateLabels(labels, row) {
  if (!VALID_RISK_LEVELS.has(labels.risk_level)) {
    throw new Error(`Invalid risk_level for sample_id=${row.sample_id}`);
  }
  if (!VALID_INTERVENTION_STATES.has(labels.intervention_state)) {
    throw new Error(`Invalid intervention_state for sample_id=${row.sample_id}`);
  }
  if (labels.escalate !== 0 && labels.escalate !== 1) {
    throw new Error(`Invalid escalate for sample_id=${row.sample_id}`);
  }
}

function summarizeMissingSelections(rows) {
  const missing = rows
    .filter((row) => !normalizeText(row.selected_candidate_id))
    .map((row) => row.sample_id);
  if (missing.length === 0) return null;
  return `${missing.length} manifest rows are missing selected_candidate_id (${missing
    .slice(0, 5)
    .join(', ')}${missing.length > 5 ? ', ...' : ''})`;
}

function freezeDataset({ manifestRows, candidateRows, auditRows, allowPartial = false, allowExpectedLabels = false }) {
  const candidateById = new Map(candidateRows.map((row) => [row.candidate_id, row]));
  const auditByCandidateId = new Map(auditRows.map((row) => [row.candidate_id, row]));

  const missingSelectionSummary = summarizeMissingSelections(manifestRows);
  if (!allowPartial && missingSelectionSummary) {
    throw new Error(
      `Refusing to freeze a partial dataset: ${missingSelectionSummary}. Pass --allow-partial only for preview outputs.`
    );
  }

  const selectedRows = manifestRows.filter((row) => normalizeText(row.selected_candidate_id));
  if (selectedRows.length === 0) {
    throw new Error('No manifest rows contain selected_candidate_id; nothing to freeze');
  }

  const cases = [];
  const gold = [];
  const provenance = [];

  for (const row of selectedRows) {
    const candidateId = normalizeText(row.selected_candidate_id);
    if (!candidateId) {
      throw new Error(`Empty selected_candidate_id for sample_id=${row.sample_id}`);
    }
    const candidate = candidateById.get(candidateId);
    if (!candidate) {
      throw new Error(`Selected candidate ${candidateId} not found for sample_id=${row.sample_id}`);
    }
    const audit = auditByCandidateId.get(candidateId);
    if (!audit) {
      throw new Error(`Missing audit row for selected candidate ${candidateId}`);
    }
    if (audit.status !== 'pass') {
      throw new Error(`Selected candidate ${candidateId} did not pass audit`);
    }
    if (normalizeText(candidate.sample_id) && normalizeText(candidate.sample_id) !== row.sample_id) {
      throw new Error(
        `Selected candidate ${candidateId} belongs to sample_id=${candidate.sample_id}, expected ${row.sample_id}`
      );
    }

    const { labels, labelSource } = resolveFinalLabels(row, { allowExpectedLabels });
    validateLabels(labels, row);

    cases.push({
      case_id: row.case_id,
      base_task_id: row.base_task_id,
      variant_id: row.variant_id,
      slice: row.slice,
      history: candidate.history,
      current_user_message: candidate.current_user_message,
      task_context: candidate.task_context,
    });

    gold.push({
      case_id: row.case_id,
      base_task_id: row.base_task_id,
      variant_id: row.variant_id,
      slice: row.slice,
      task_domain: row.task_domain,
      labels: {
        risk_level: labels.risk_level,
        intervention_state: labels.intervention_state,
        escalate: labels.escalate,
        rationale: labels.rationale ?? null,
      },
    });

    provenance.push({
      case_id: row.case_id,
      sample_id: row.sample_id,
      candidate_id: candidateId,
      split: row.split,
      generation_template_id: row.generation_template_id,
      selected_candidate_notes: row.selected_candidate_notes ?? null,
      final_label_notes: row.final_label_notes ?? null,
      annotation_log_ref: row.annotation_log_ref ?? null,
      adjudication_log_ref: row.adjudication_log_ref ?? null,
      audit: {
        status: audit.status,
        issue_count: audit.issue_count,
        leakage_flags: audit.leakage_flags,
      },
      label_source: labelSource,
      expected_label_tendency: row.expected_label_tendency,
      final_labels: labels,
      source_type: candidate.source_type ?? null,
      source_model: candidate.source_model ?? null,
      author_id: candidate.author_id ?? null,
    });
  }

  return {
    cases,
    gold,
    provenance,
  };
}

function buildFreezeSummary(frozen) {
  return {
    frozen_case_count: frozen.cases.length,
    split_counts: frozen.provenance.reduce((acc, row) => {
      acc[row.split] = (acc[row.split] ?? 0) + 1;
      return acc;
    }, {}),
    label_source_counts: frozen.provenance.reduce((acc, row) => {
      acc[row.label_source] = (acc[row.label_source] ?? 0) + 1;
      return acc;
    }, {}),
    risk_level_counts: frozen.gold.reduce((acc, row) => {
      acc[row.labels.risk_level] = (acc[row.labels.risk_level] ?? 0) + 1;
      return acc;
    }, {}),
    intervention_state_counts: frozen.gold.reduce((acc, row) => {
      acc[row.labels.intervention_state] = (acc[row.labels.intervention_state] ?? 0) + 1;
      return acc;
    }, {}),
    escalate_counts: frozen.gold.reduce((acc, row) => {
      const key = String(row.labels.escalate);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

function outputPaths(outputDir) {
  return {
    casesPath: path.join(outputDir, 'cases.v1.jsonl'),
    goldPath: path.join(outputDir, 'gold.v1.jsonl'),
    provenancePath: path.join(outputDir, 'provenance-map.v1.json'),
    summaryPath: path.join(outputDir, 'freeze-summary.v1.json'),
  };
}

function printHelp() {
  console.log(`Usage:
node scripts/benchmarks/freeze-affect-thesis-v2-dataset.cjs \\
  --manifest research/affect-thesis-v2/dataset-manifest.v1.jsonl \\
  --candidates research/affect-thesis-v2/candidate-pool.v1.jsonl \\
  --audit research/affect-thesis-v2/audits/candidate-audit.v1.jsonl \\
  --output-dir research/affect-thesis-v2/frozen

By default this command requires manifest.final_labels for every selected sample and refuses to
freeze a partial dataset. Use --allow-partial or --allow-expected-labels only for preview / debug
artifacts, not for the thesis final freeze.`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const manifestRows = loadJsonl(args.manifestPath);
  const candidateRows = loadJsonl(args.candidatesPath);
  const auditRows = loadJsonl(args.auditPath);
  const frozen = freezeDataset({
    manifestRows,
    candidateRows,
    auditRows,
    allowPartial: args.allowPartial,
    allowExpectedLabels: args.allowExpectedLabels,
  });
  const summary = buildFreezeSummary(frozen);
  const paths = outputPaths(args.outputDir);

  writeJsonl(paths.casesPath, frozen.cases);
  writeJsonl(paths.goldPath, frozen.gold);
  writeJson(paths.provenancePath, frozen.provenance);
  writeJson(paths.summaryPath, summary);

  console.log(
    JSON.stringify(
      {
        output_dir: args.outputDir,
        frozen_case_count: frozen.cases.length,
      },
      null,
      2
    )
  );
}

module.exports = {
  DEFAULTS,
  parseArgs,
  validateLabels,
  freezeDataset,
  buildFreezeSummary,
  outputPaths,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
