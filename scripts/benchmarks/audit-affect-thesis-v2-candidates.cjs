#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { detectCueLeakage } = require('./derive-affect-thesis-manifest.cjs');

const DEFAULTS = {
  manifestPath: 'research/affect-thesis-v2/dataset-manifest.v1.jsonl',
  outputDir: 'research/affect-thesis-v2/audits',
};

function parseArgs(argv) {
  const args = { ...DEFAULTS, candidatesPath: null };
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

  if (!args.help && !args.candidatesPath) {
    throw new Error('Missing required --candidates');
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

function normalizeSignature(candidate) {
  const historyText = Array.isArray(candidate.history)
    ? candidate.history
        .map((entry) => `${normalizeText(entry.role)}:${normalizeText(entry.text)}`)
        .join('\n')
    : '';
  const constraints = Array.isArray(candidate.task_context?.constraints)
    ? candidate.task_context.constraints.map((entry) => normalizeText(entry)).join('\n')
    : '';
  return [historyText, normalizeText(candidate.current_user_message), normalizeText(candidate.task_context?.goal), normalizeText(candidate.task_context?.deliverable), constraints]
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function validateCandidateShape(candidate) {
  const issues = [];
  if (!normalizeText(candidate.candidate_id)) {
    issues.push({ code: 'missing_candidate_id', severity: 'error', message: 'candidate_id is required' });
  }
  if (!normalizeText(candidate.sample_id)) {
    issues.push({ code: 'missing_sample_id', severity: 'error', message: 'sample_id is required' });
  }
  if (!Array.isArray(candidate.history)) {
    issues.push({ code: 'missing_history', severity: 'error', message: 'history must be an array' });
  } else {
    for (const entry of candidate.history) {
      const role = normalizeText(entry?.role);
      const text = normalizeText(entry?.text);
      if (role !== 'user' && role !== 'assistant') {
        issues.push({
          code: 'invalid_history_role',
          severity: 'error',
          message: `history role must be user/assistant, got ${role || '(empty)'}`,
        });
        break;
      }
      if (!text) {
        issues.push({
          code: 'empty_history_text',
          severity: 'error',
          message: 'history entry text must be non-empty',
        });
        break;
      }
    }
  }
  if (!normalizeText(candidate.current_user_message)) {
    issues.push({
      code: 'missing_current_user_message',
      severity: 'error',
      message: 'current_user_message is required',
    });
  }
  if (!candidate.task_context || typeof candidate.task_context !== 'object' || Array.isArray(candidate.task_context)) {
    issues.push({ code: 'missing_task_context', severity: 'error', message: 'task_context must be an object' });
  } else {
    if (!normalizeText(candidate.task_context.goal)) {
      issues.push({ code: 'missing_task_context_goal', severity: 'error', message: 'task_context.goal is required' });
    }
    if (!normalizeText(candidate.task_context.deliverable)) {
      issues.push({
        code: 'missing_task_context_deliverable',
        severity: 'error',
        message: 'task_context.deliverable is required',
      });
    }
    if (!Array.isArray(candidate.task_context.constraints)) {
      issues.push({
        code: 'missing_task_context_constraints',
        severity: 'error',
        message: 'task_context.constraints must be an array',
      });
    }
  }
  return issues;
}

function auditCandidates({ manifestRows, candidateRows }) {
  const manifestBySampleId = new Map(manifestRows.map((row) => [row.sample_id, row]));
  const seenCandidateIds = new Set();
  const seenSignatures = new Map();
  const auditRows = [];

  for (const candidate of candidateRows) {
    const issues = validateCandidateShape(candidate);
    const candidateId = normalizeText(candidate.candidate_id);
    const sampleId = normalizeText(candidate.sample_id);
    const manifestRow = manifestBySampleId.get(sampleId) ?? null;

    if (candidateId && seenCandidateIds.has(candidateId)) {
      issues.push({
        code: 'duplicate_candidate_id',
        severity: 'error',
        message: `candidate_id ${candidateId} is duplicated`,
      });
    }
    if (candidateId) {
      seenCandidateIds.add(candidateId);
    }

    if (!manifestRow) {
      issues.push({
        code: 'unknown_sample_id',
        severity: 'error',
        message: `sample_id ${sampleId || '(empty)'} not found in manifest`,
      });
    }

    const combinedText = [
      ...(Array.isArray(candidate.history) ? candidate.history.map((entry) => normalizeText(entry.text)) : []),
      normalizeText(candidate.current_user_message),
    ]
      .filter(Boolean)
      .join('\n');
    const cueAudit = detectCueLeakage(combinedText);
    for (const flag of cueAudit.flags) {
      issues.push({
        code: `leakage_${flag.id}`,
        severity: flag.severity === 'high' ? 'error' : 'warn',
        message: flag.note,
      });
    }

    if (manifestRow) {
      const bannedHits = (manifestRow.cue_banlist ?? []).filter((entry) =>
        combinedText.includes(entry)
      );
      for (const hit of bannedHits) {
        issues.push({
          code: 'manifest_banlist_hit',
          severity: 'error',
          message: `hit banned cue: ${hit}`,
        });
      }
    }

    const signature = normalizeSignature(candidate);
    if (signature) {
      const priorCandidateId = seenSignatures.get(signature);
      if (priorCandidateId) {
        issues.push({
          code: 'duplicate_signature',
          severity: 'error',
          message: `candidate text duplicates ${priorCandidateId}`,
        });
      } else if (candidateId) {
        seenSignatures.set(signature, candidateId);
      }
    }

    const status = issues.some((issue) => issue.severity === 'error') ? 'fail' : 'pass';
    auditRows.push({
      candidate_id: candidateId,
      sample_id: sampleId,
      status,
      issue_count: issues.length,
      issues,
      leakage_priority: cueAudit.priority,
      leakage_flags: cueAudit.flags.map((flag) => flag.id),
      normalized_signature: signature,
    });
  }

  return auditRows;
}

function buildAuditSummary(auditRows) {
  const summary = {
    total_candidates: auditRows.length,
    status_counts: {},
    issue_code_counts: {},
  };
  for (const row of auditRows) {
    summary.status_counts[row.status] = (summary.status_counts[row.status] ?? 0) + 1;
    for (const issue of row.issues) {
      summary.issue_code_counts[issue.code] = (summary.issue_code_counts[issue.code] ?? 0) + 1;
    }
  }
  return summary;
}

function outputPaths(outputDir) {
  return {
    auditPath: path.join(outputDir, 'candidate-audit.v1.jsonl'),
    summaryPath: path.join(outputDir, 'candidate-audit-summary.v1.json'),
  };
}

function printHelp() {
  console.log(`Usage:
node scripts/benchmarks/audit-affect-thesis-v2-candidates.cjs \\
  --manifest research/affect-thesis-v2/dataset-manifest.v1.jsonl \\
  --candidates research/affect-thesis-v2/candidate-pool.v1.jsonl \\
  --output-dir research/affect-thesis-v2/audits`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const manifestRows = loadJsonl(args.manifestPath);
  const candidateRows = loadJsonl(args.candidatesPath);
  const auditRows = auditCandidates({ manifestRows, candidateRows });
  const summary = buildAuditSummary(auditRows);
  const paths = outputPaths(args.outputDir);

  writeJsonl(paths.auditPath, auditRows);
  writeJson(paths.summaryPath, summary);

  console.log(
    JSON.stringify(
      {
        audit_path: paths.auditPath,
        summary_path: paths.summaryPath,
        total_candidates: auditRows.length,
        failed_candidates: summary.status_counts.fail ?? 0,
      },
      null,
      2
    )
  );
}

module.exports = {
  DEFAULTS,
  parseArgs,
  normalizeSignature,
  validateCandidateShape,
  auditCandidates,
  buildAuditSummary,
  outputPaths,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
