#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  manifestPath: 'research/affect-thesis-v2/dataset-manifest.v1.jsonl',
  outputDir: 'research/affect-thesis-v2',
};

function parseArgs(argv) {
  const args = {
    ...DEFAULTS,
    inputPaths: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') {
      args.manifestPath = argv[index + 1] ?? args.manifestPath;
      index += 1;
      continue;
    }
    if (arg === '--input') {
      const value = argv[index + 1] ?? '';
      args.inputPaths.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
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

  if (!args.help && args.inputPaths.length === 0) {
    throw new Error('Missing required --input');
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

function loadStructuredRows(filePath) {
  const rawText = fs.readFileSync(filePath, 'utf8').trim();
  if (!rawText) return [];
  if (filePath.endsWith('.jsonl')) {
    return rawText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  const parsed = JSON.parse(rawText);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  return [parsed];
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

function slugify(value) {
  return normalizeText(value)
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function sourceStem(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function buildCandidateId({ sampleId, batchId, sourceFile, position }) {
  const basis = slugify(batchId) || slugify(sourceStem(sourceFile)) || 'batch';
  return `${sampleId}__${basis}__${String(position + 1).padStart(2, '0')}`;
}

function flattenCandidateBatches({ manifestRows, batchRowsByInput }) {
  const manifestBySampleId = new Map(manifestRows.map((row) => [row.sample_id, row]));
  const seenCandidateIds = new Set();
  const candidateRows = [];
  const sampleCounts = {};
  const sourceTypeCounts = {};
  const sourceModelCounts = {};
  let generatedIdCount = 0;
  let totalBatches = 0;

  for (const { inputPath, rows } of batchRowsByInput) {
    rows.forEach((batchRow, batchIndex) => {
      totalBatches += 1;
      const sampleId = normalizeText(batchRow.sample_id);
      if (!sampleId) {
        throw new Error(`Missing sample_id in ${inputPath} batch #${batchIndex + 1}`);
      }
      const manifestRow = manifestBySampleId.get(sampleId);
      if (!manifestRow) {
        throw new Error(`Unknown sample_id ${sampleId} in ${inputPath}`);
      }
      if (!Array.isArray(batchRow.candidates) || batchRow.candidates.length === 0) {
        throw new Error(`Batch for sample_id=${sampleId} in ${inputPath} has no candidates`);
      }

      const batchId =
        normalizeText(batchRow.batch_id) ||
        `${sourceStem(inputPath)}_${String(batchIndex + 1).padStart(2, '0')}`;
      const packetId = normalizeText(batchRow.packet_id);
      const generationTemplateId =
        normalizeText(batchRow.generation_template_id) || manifestRow.generation_template_id;
      const sourceType = normalizeText(batchRow.source_type);
      const sourceModel = normalizeText(batchRow.source_model);
      const authorId = normalizeText(batchRow.author_id);
      const generatedAt = normalizeText(batchRow.generated_at);

      batchRow.candidates.forEach((candidate, candidateIndex) => {
        const candidateSampleId = normalizeText(candidate.sample_id);
        if (candidateSampleId && candidateSampleId !== sampleId) {
          throw new Error(
            `Candidate sample_id mismatch in ${inputPath}: ${candidateSampleId} != ${sampleId}`
          );
        }

        const candidatePacketId = normalizeText(candidate.packet_id);
        if (packetId && candidatePacketId && candidatePacketId !== packetId) {
          throw new Error(
            `Candidate packet_id mismatch in ${inputPath}: ${candidatePacketId} != ${packetId}`
          );
        }

        let candidateId = normalizeText(candidate.candidate_id);
        if (!candidateId) {
          candidateId = buildCandidateId({
            sampleId,
            batchId,
            sourceFile: inputPath,
            position: candidateIndex,
          });
          generatedIdCount += 1;
        }
        if (seenCandidateIds.has(candidateId)) {
          throw new Error(`Duplicate candidate_id detected during ingest: ${candidateId}`);
        }
        seenCandidateIds.add(candidateId);

        const row = {
          candidate_id: candidateId,
          sample_id: sampleId,
          case_id: manifestRow.case_id,
          split: manifestRow.split,
          packet_id: candidatePacketId || packetId || null,
          batch_id: batchId,
          generation_template_id: generationTemplateId || null,
          source_type: normalizeText(candidate.source_type) || sourceType || null,
          source_model: normalizeText(candidate.source_model) || sourceModel || null,
          author_id: normalizeText(candidate.author_id) || authorId || null,
          generated_at: normalizeText(candidate.generated_at) || generatedAt || null,
          source_file: inputPath,
          history: candidate.history,
          current_user_message: candidate.current_user_message,
          task_context: candidate.task_context,
          author_notes: candidate.author_notes ?? null,
        };

        candidateRows.push(row);
        sampleCounts[sampleId] = (sampleCounts[sampleId] ?? 0) + 1;
        if (row.source_type) {
          sourceTypeCounts[row.source_type] = (sourceTypeCounts[row.source_type] ?? 0) + 1;
        }
        if (row.source_model) {
          sourceModelCounts[row.source_model] = (sourceModelCounts[row.source_model] ?? 0) + 1;
        }
      });
    });
  }

  return {
    candidateRows,
    summary: {
      total_batches: totalBatches,
      total_candidates: candidateRows.length,
      generated_candidate_id_count: generatedIdCount,
      sample_counts: sampleCounts,
      source_type_counts: sourceTypeCounts,
      source_model_counts: sourceModelCounts,
    },
  };
}

function outputPaths(outputDir) {
  return {
    candidatePoolPath: path.join(outputDir, 'candidate-pool.v1.jsonl'),
    summaryPath: path.join(outputDir, 'candidate-pool-summary.v1.json'),
  };
}

function printHelp() {
  console.log(`Usage:
node scripts/benchmarks/ingest-affect-thesis-v2-candidate-batches.cjs \\
  --manifest research/affect-thesis-v2/dataset-manifest.v1.jsonl \\
  --input research/affect-thesis-v2/candidate-batches.v1.jsonl \\
  --output-dir research/affect-thesis-v2`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const manifestRows = loadJsonl(args.manifestPath);
  const batchRowsByInput = args.inputPaths.map((inputPath) => ({
    inputPath,
    rows: loadStructuredRows(inputPath),
  }));
  const { candidateRows, summary } = flattenCandidateBatches({ manifestRows, batchRowsByInput });
  const paths = outputPaths(args.outputDir);

  writeJsonl(paths.candidatePoolPath, candidateRows);
  writeJson(paths.summaryPath, summary);

  console.log(
    JSON.stringify(
      {
        candidate_pool_path: paths.candidatePoolPath,
        summary_path: paths.summaryPath,
        total_candidates: summary.total_candidates,
      },
      null,
      2
    )
  );
}

module.exports = {
  DEFAULTS,
  parseArgs,
  flattenCandidateBatches,
  outputPaths,
  buildCandidateId,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
