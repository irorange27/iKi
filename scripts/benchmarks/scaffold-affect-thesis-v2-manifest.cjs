#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  blueprintPath: 'research/affect-thesis-v2/blueprint.v1.json',
  outputDir: 'research/affect-thesis-v2',
};

const MAIN_PACKET_TEMPLATE_ID = 'main_affect_candidate_writer_v1';
const NEUTRAL_PACKET_TEMPLATE_ID = 'neutral_control_candidate_writer_v1';

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--blueprint') {
      args.blueprintPath = argv[index + 1] ?? args.blueprintPath;
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
  return args;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function padId(index) {
  return String(index + 1).padStart(3, '0');
}

function buildMainRows(blueprint, startIndex = 0) {
  const variantById = new Map(
    (blueprint.main_affect?.variants ?? []).map((variant) => [variant.variant_id, variant])
  );
  const rows = [];
  let index = startIndex;

  for (const task of blueprint.main_affect?.base_tasks ?? []) {
    for (const variant of blueprint.main_affect?.variants ?? []) {
      const taskContext = task.task_context_by_variant?.[variant.variant_id];
      if (!taskContext) {
        throw new Error(
          `Missing task_context_by_variant.${variant.variant_id} for base_task_id=${task.base_task_id}`
        );
      }

      const rowIndex = padId(index);
      rows.push({
        sample_id: `manifest_thesis_main_v2_${rowIndex}`,
        split: blueprint.main_affect.split || 'main_affect',
        case_id: `thesis_main_v2_${rowIndex}`,
        base_task_id: task.base_task_id,
        variant_id: variant.variant_id,
        slice: task.slice,
        task_domain: task.task_domain,
        subtemplate: task.subtemplate,
        source_recipe: task.source_recipe,
        scenario_stub: task.scenario_stub,
        task_context_stub: taskContext.goal,
        task_context_deliverable_stub: taskContext.deliverable,
        task_context_constraints_stub: [...(taskContext.constraints ?? [])],
        contrast_anchor: task.base_task_id,
        goal_clarity: variant.latent_defaults.goal_clarity,
        authority_clarity: variant.latent_defaults.authority_clarity,
        missing_info_level: variant.latent_defaults.missing_info_level,
        affect_load_level: variant.latent_defaults.affect_load_level,
        readiness_to_act_level: variant.latent_defaults.readiness_to_act_level,
        functional_impairment_level: variant.latent_defaults.functional_impairment_level,
        boundary_risk_level: variant.latent_defaults.boundary_risk_level,
        decision_ambiguity_level: variant.latent_defaults.decision_ambiguity_level,
        expected_label_tendency: {
          risk_level: variant.default_gold.risk_level,
          intervention_state: variant.default_gold.intervention_state,
          escalate: variant.default_gold.escalate,
          rationale_stub: variant.default_gold.rationale_stub,
        },
        writer_intent: variant.writer_intent,
        cue_banlist: [...(variant.cue_banlist ?? [])],
        candidate_quota: blueprint.candidate_quota_per_slot ?? 6,
        generation_template_id: MAIN_PACKET_TEMPLATE_ID,
        draft_status: 'planned',
        candidate_status: 'pending',
        audit_status: 'pending',
        annotation_status: 'pending',
        adjudication_status: 'pending',
        freeze_status: 'pending',
        selected_candidate_id: null,
        selected_candidate_notes: null,
        final_labels: null,
        final_label_notes: null,
        annotation_log_ref: null,
        adjudication_log_ref: null,
      });
      index += 1;
    }
  }

  if (rows.length === 0) {
    throw new Error('Blueprint did not produce any main_affect rows');
  }

  if (variantById.size === 0) {
    throw new Error('Blueprint main_affect.variants is empty');
  }

  return rows;
}

function buildNeutralRows(blueprint, startIndex) {
  const rows = [];
  let index = startIndex;

  for (const task of blueprint.neutral_control?.tasks ?? []) {
    const rowIndex = padId(index);
    rows.push({
      sample_id: `manifest_thesis_neutral_v2_${rowIndex}`,
      split: blueprint.neutral_control.split || 'neutral_control',
      case_id: `thesis_neutral_v2_${rowIndex}`,
      base_task_id: task.base_task_id,
      variant_id: task.variant_id,
      slice: task.slice,
      task_domain: task.task_domain,
      subtemplate: task.subtemplate,
      source_recipe: task.source_recipe,
      scenario_stub: task.scenario_stub,
      task_context_stub: task.task_context.goal,
      task_context_deliverable_stub: task.task_context.deliverable,
      task_context_constraints_stub: [...(task.task_context.constraints ?? [])],
      contrast_anchor: task.base_task_id,
      goal_clarity:
        task.default_gold.intervention_state === 'clarify' ? 'medium' : 'high',
      authority_clarity:
        task.default_gold.intervention_state === 'clarify' ? 'medium' : 'high',
      missing_info_level:
        task.default_gold.intervention_state === 'clarify' ? 'high' : 'low',
      affect_load_level: 'low',
      readiness_to_act_level:
        task.default_gold.intervention_state === 'clarify' ? 'medium' : 'high',
      functional_impairment_level: 'low',
      boundary_risk_level: 'low',
      decision_ambiguity_level:
        task.default_gold.intervention_state === 'clarify' ? 'high' : 'low',
      expected_label_tendency: {
        risk_level: task.default_gold.risk_level,
        intervention_state: task.default_gold.intervention_state,
        escalate: task.default_gold.escalate,
        rationale_stub: task.default_gold.rationale_stub,
      },
      writer_intent: '普通中性生产力控制任务，不引入 affect-heavy 语言。',
      cue_banlist: [],
      candidate_quota: blueprint.candidate_quota_per_slot ?? 6,
      generation_template_id: NEUTRAL_PACKET_TEMPLATE_ID,
      draft_status: 'planned',
      candidate_status: 'pending',
      audit_status: 'pending',
      annotation_status: 'pending',
      adjudication_status: 'pending',
      freeze_status: 'pending',
      selected_candidate_id: null,
      selected_candidate_notes: null,
      final_labels: null,
      final_label_notes: null,
      annotation_log_ref: null,
      adjudication_log_ref: null,
    });
    index += 1;
  }

  if (rows.length === 0) {
    throw new Error('Blueprint did not produce any neutral_control rows');
  }

  return rows;
}

function buildManifestFromBlueprint(
  blueprint,
  { mainStartIndex = 0, neutralStartIndex = 0, allowEmptySplits = false } = {}
) {
  const hasMainRows =
    Array.isArray(blueprint.main_affect?.variants) &&
    blueprint.main_affect.variants.length > 0 &&
    Array.isArray(blueprint.main_affect?.base_tasks) &&
    blueprint.main_affect.base_tasks.length > 0;
  const hasNeutralRows =
    Array.isArray(blueprint.neutral_control?.tasks) && blueprint.neutral_control.tasks.length > 0;

  const mainRows = hasMainRows ? buildMainRows(blueprint, mainStartIndex) : [];
  const neutralRows = hasNeutralRows ? buildNeutralRows(blueprint, neutralStartIndex) : [];
  const rows = [...mainRows, ...neutralRows];
  if (!allowEmptySplits && !hasMainRows) {
    throw new Error('Blueprint did not produce any main_affect rows');
  }
  if (!allowEmptySplits && !hasNeutralRows) {
    throw new Error('Blueprint did not produce any neutral_control rows');
  }
  if (rows.length === 0) {
    throw new Error('Blueprint did not produce any manifest rows');
  }
  return rows;
}

function buildManifestSummary(rows, blueprintPath) {
  const summary = {
    total_rows: rows.length,
    split_counts: {},
    variant_counts: {},
    slice_counts: {},
    task_domain_counts: {},
    candidate_quota_counts: {},
  };

  if (Array.isArray(blueprintPath)) {
    summary.blueprint_paths = blueprintPath.filter(Boolean);
  } else if (blueprintPath) {
    summary.blueprint_path = blueprintPath;
  }

  for (const row of rows) {
    summary.split_counts[row.split] = (summary.split_counts[row.split] ?? 0) + 1;
    summary.variant_counts[row.variant_id] = (summary.variant_counts[row.variant_id] ?? 0) + 1;
    summary.slice_counts[row.slice] = (summary.slice_counts[row.slice] ?? 0) + 1;
    summary.task_domain_counts[row.task_domain] =
      (summary.task_domain_counts[row.task_domain] ?? 0) + 1;
    const quotaKey = String(row.candidate_quota);
    summary.candidate_quota_counts[quotaKey] =
      (summary.candidate_quota_counts[quotaKey] ?? 0) + 1;
  }

  return summary;
}

function outputPaths(outputDir) {
  return {
    manifestPath: path.join(outputDir, 'dataset-manifest.v1.jsonl'),
    summaryPath: path.join(outputDir, 'manifest-summary.v1.json'),
  };
}

function printHelp() {
  console.log(`Usage:
node scripts/benchmarks/scaffold-affect-thesis-v2-manifest.cjs \\
  --blueprint research/affect-thesis-v2/blueprint.v1.json \\
  --output-dir research/affect-thesis-v2`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const blueprint = loadJson(args.blueprintPath);
  const rows = buildManifestFromBlueprint(blueprint);
  const paths = outputPaths(args.outputDir);
  const summary = buildManifestSummary(rows, args.blueprintPath);

  writeJsonl(paths.manifestPath, rows);
  writeJson(paths.summaryPath, summary);

  console.log(
    JSON.stringify(
      {
        output_dir: args.outputDir,
        manifest_path: paths.manifestPath,
        summary_path: paths.summaryPath,
        total_rows: rows.length,
      },
      null,
      2
    )
  );
}

module.exports = {
  DEFAULTS,
  MAIN_PACKET_TEMPLATE_ID,
  NEUTRAL_PACKET_TEMPLATE_ID,
  parseArgs,
  buildMainRows,
  buildNeutralRows,
  buildManifestFromBlueprint,
  buildManifestSummary,
  outputPaths,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
