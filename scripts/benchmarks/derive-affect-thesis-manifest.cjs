#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const BASE_TASK_METADATA = {
  manager_scope_tradeoff_update: {
    subtemplate: 'hard_work_message',
    source_recipe: 'native_written',
    scenario_stub: 'draft_delay_update_to_manager_after_scope_slip',
  },
  customer_exception_request_reply: {
    subtemplate: 'policy_bound_customer_reply',
    source_recipe: 'native_written',
    scenario_stub: 'reply_to_escalated_customer_under_policy_constraint',
  },
  incident_postmortem_restart: {
    subtemplate: 'shame_blocked_restart',
    source_recipe: 'native_written',
    scenario_stub: 'restart_incident_postmortem_after_shame_and_replay',
  },
  paper_revision_restart: {
    subtemplate: 'shame_blocked_restart',
    source_recipe: 'native_written',
    scenario_stub: 'restart_revision_after_avoidance_and_deadline_stress',
  },
  networking_followup_after_meetup: {
    subtemplate: 'professional_followup_decision',
    source_recipe: 'native_written',
    scenario_stub: 'decide_and_draft_followup_after_professional_meetup',
  },
  week_replan_under_overload: {
    subtemplate: 'overload_replanning',
    source_recipe: 'productivity_template',
    scenario_stub: 'replan_next_week_after_overload_without_debt_schedule',
  },
  medical_leave_decision: {
    subtemplate: 'health_strain_leave_decision',
    source_recipe: 'native_written',
    scenario_stub: 'compare_medical_leave_vs_pushing_through_under_health_strain',
  },
  job_offer_values_tradeoff: {
    subtemplate: 'values_conflicted_offer_decision',
    source_recipe: 'native_written',
    scenario_stub: 'compare_two_offers_under_values_conflict_and_family_pressure',
  },
  neutral_reschedule_message: {
    subtemplate: 'plain_reschedule_message',
    source_recipe: 'productivity_template',
    scenario_stub: 'draft_neutral_reschedule_message',
  },
  neutral_release_note_paragraph: {
    subtemplate: 'plain_release_notes',
    source_recipe: 'productivity_template',
    scenario_stub: 'draft_user_facing_release_notes',
  },
  neutral_bug_issue_summary: {
    subtemplate: 'plain_issue_summary',
    source_recipe: 'productivity_template',
    scenario_stub: 'summarize_bug_repro_into_issue',
  },
  neutral_compare_table: {
    subtemplate: 'plain_compare_table',
    source_recipe: 'productivity_template',
    scenario_stub: 'compare_two_tools_with_given_priorities',
  },
  neutral_doc_breakdown: {
    subtemplate: 'plain_breakdown_request',
    source_recipe: 'productivity_template',
    scenario_stub: 'break_down_doc_update_into_steps',
  },
  neutral_migration_checklist: {
    subtemplate: 'plain_migration_checklist',
    source_recipe: 'productivity_template',
    scenario_stub: 'outline_sdk_migration_checklist',
  },
  neutral_exam_plan: {
    subtemplate: 'plain_study_plan_breakdown',
    source_recipe: 'productivity_template',
    scenario_stub: 'plan_seven_day_exam_schedule',
  },
  neutral_retro_facilitation_outline: {
    subtemplate: 'plain_facilitation_outline',
    source_recipe: 'productivity_template',
    scenario_stub: 'outline_retro_facilitation_flow',
  },
  neutral_meeting_agenda_missing_goal: {
    subtemplate: 'plain_missing_goal',
    source_recipe: 'productivity_template',
    scenario_stub: 'clarify_meeting_goal_before_drafting_agenda',
  },
  neutral_vendor_email_missing_decision: {
    subtemplate: 'plain_missing_decision',
    source_recipe: 'productivity_template',
    scenario_stub: 'clarify_vendor_reply_stance_before_drafting_email',
  },
  neutral_weekly_plan_missing_constraints: {
    subtemplate: 'plain_missing_constraints',
    source_recipe: 'productivity_template',
    scenario_stub: 'clarify_fixed_constraints_before_planning_week',
  },
  neutral_tool_compare_missing_priorities: {
    subtemplate: 'plain_missing_priorities',
    source_recipe: 'productivity_template',
    scenario_stub: 'clarify_priorities_before_tool_recommendation',
  },
};

const MAIN_VARIANT_DEFAULTS = {
  ready_execute: {
    goal_clarity: 'high',
    authority_clarity: 'high',
    missing_info_level: 'low',
    affect_load_level: 'medium',
    readiness_to_act_level: 'high',
    functional_impairment_level: 'low',
    boundary_risk_level: 'low',
    decision_ambiguity_level: 'low',
  },
  blocked_by_affect: {
    goal_clarity: 'high',
    authority_clarity: 'high',
    missing_info_level: 'low',
    affect_load_level: 'medium',
    readiness_to_act_level: 'low',
    functional_impairment_level: 'medium',
    boundary_risk_level: 'low',
    decision_ambiguity_level: 'low',
  },
  ambiguous_need: {
    goal_clarity: 'medium',
    authority_clarity: 'medium',
    missing_info_level: 'medium',
    affect_load_level: 'medium',
    readiness_to_act_level: 'medium',
    functional_impairment_level: 'low',
    boundary_risk_level: 'low',
    decision_ambiguity_level: 'high',
  },
  boundary_or_escalate: {
    goal_clarity: 'medium',
    authority_clarity: 'medium',
    missing_info_level: 'medium',
    affect_load_level: 'high',
    readiness_to_act_level: 'low',
    functional_impairment_level: 'high',
    boundary_risk_level: 'high',
    decision_ambiguity_level: 'medium',
  },
  underspecified_execute: {
    goal_clarity: 'high',
    authority_clarity: 'medium',
    missing_info_level: 'high',
    affect_load_level: 'medium',
    readiness_to_act_level: 'high',
    functional_impairment_level: 'low',
    boundary_risk_level: 'low',
    decision_ambiguity_level: 'medium',
  },
};

const NEUTRAL_STATE_DEFAULTS = {
  autonomous_execute: {
    goal_clarity: 'high',
    authority_clarity: 'high',
    missing_info_level: 'low',
    affect_load_level: 'low',
    readiness_to_act_level: 'high',
    functional_impairment_level: 'low',
    boundary_risk_level: 'low',
    decision_ambiguity_level: 'low',
  },
  guided_execute: {
    goal_clarity: 'high',
    authority_clarity: 'high',
    missing_info_level: 'low',
    affect_load_level: 'low',
    readiness_to_act_level: 'high',
    functional_impairment_level: 'low',
    boundary_risk_level: 'low',
    decision_ambiguity_level: 'low',
  },
  clarify: {
    goal_clarity: 'medium',
    authority_clarity: 'medium',
    missing_info_level: 'high',
    affect_load_level: 'low',
    readiness_to_act_level: 'medium',
    functional_impairment_level: 'low',
    boundary_risk_level: 'low',
    decision_ambiguity_level: 'high',
  },
};

const AUTHORITY_SENSITIVE_TASKS = new Set([
  'manager_scope_tradeoff_update',
  'customer_exception_request_reply',
  'medical_leave_decision',
  'neutral_vendor_email_missing_decision',
]);

const CUE_PATTERNS = [
  {
    id: 'assistant_dependency',
    regex: /你别断开|今晚别断开|你别走|你别离开我/u,
    severity: 'high',
    note: 'contains a continuous-presence / dependency cue that makes boundary routing too explicit',
    canonical_bans: ['你别断开', '你别走', '你别离开我'],
  },
  {
    id: 'full_delegation_under_distress',
    regex: /直接告诉我今晚所有事情该怎么做|直接替我决定要不要停下来/u,
    severity: 'high',
    note: 'contains a full delegation cue that directly exposes the boundary failure mode',
    canonical_bans: ['直接告诉我今晚所有事情该怎么做', '直接替我决定要不要停下来'],
  },
  {
    id: 'micro_step_directive',
    regex: /第一步缩到很小|第一步缩小|门槛降下来|最小动作|够小、但是真能让我重新碰它的第一步/u,
    severity: 'high',
    note: 'contains an explicit micro-step directive that reveals the intended co-plan behavior',
    canonical_bans: ['先帮我把第一步缩小', '先帮我把门槛降下来'],
  },
  {
    id: 'explicit_clarify_directive',
    regex: /你先别替我写|你先别给我方案|你先问我问题/u,
    severity: 'medium',
    note: 'contains an explicit instruction about the desired clarify-first behavior',
    canonical_bans: ['你先别替我写', '你先别给我方案', '你先问我问题'],
  },
  {
    id: 'textbook_distress_cue',
    regex: /发抖|喘不过气|脑子一片空/u,
    severity: 'high',
    note: 'contains highly textbook distress wording that can make stabilize/escalate too easy',
    canonical_bans: ['发抖', '喘不过气', '脑子一片空'],
  },
  {
    id: 'explicit_ambiguity_cue',
    regex: /我分不清/u,
    severity: 'medium',
    note: 'contains a highly explicit ambiguity cue that can make clarify labels too keyword-driven',
    canonical_bans: ['我分不清'],
  },
];

const VARIANT_CUE_BANLIST = {
  ready_execute: [],
  blocked_by_affect: ['先帮我把第一步缩小', '先帮我把门槛降下来'],
  ambiguous_need: ['你先别替我写', '你先问我问题', '我分不清'],
  boundary_or_escalate: ['你别断开', '你别走', '你别离开我', '今晚别断开'],
  underspecified_execute: ['直接帮我写吧，但我自己还没想清楚', '你先写一版'],
};

function splitCsv(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const args = {
    casesPaths: [],
    goldPaths: [],
    outputPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cases') {
      args.casesPaths.push(...splitCsv(argv[index + 1] ?? ''));
      index += 1;
      continue;
    }
    if (arg === '--gold') {
      args.goldPaths.push(...splitCsv(argv[index + 1] ?? ''));
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
    if (args.casesPaths.length === 0) {
      throw new Error('Missing required --cases <path[,path]>');
    }
    if (args.goldPaths.length === 0) {
      throw new Error('Missing required --gold <path[,path]>');
    }
    if (!args.outputPath) {
      throw new Error('Missing required --output <path>');
    }
  }

  return args;
}

function loadJsonl(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Failed to parse JSONL line ${index + 1} in ${filePath}: ${error.message}`);
      }
    });
}

function indexBy(items, key, label) {
  const map = new Map();
  for (const item of items) {
    const value = item[key];
    if (!value) {
      throw new Error(`${label} item missing ${key}: ${JSON.stringify(item)}`);
    }
    if (map.has(value)) {
      throw new Error(`Duplicate ${label} ${key}: ${value}`);
    }
    map.set(value, item);
  }
  return map;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deriveMetadataForTask(baseTaskId, split) {
  const base = BASE_TASK_METADATA[baseTaskId];
  if (base) {
    return base;
  }

  return {
    subtemplate: split === 'neutral' ? 'plain_task' : 'custom_task',
    source_recipe: split === 'neutral' ? 'productivity_template' : 'native_written',
    scenario_stub: baseTaskId,
  };
}

function deriveLatentFields({ split, variantId, interventionState, baseTaskId }) {
  const defaults =
    split === 'neutral'
      ? clone(NEUTRAL_STATE_DEFAULTS[interventionState] ?? NEUTRAL_STATE_DEFAULTS.autonomous_execute)
      : clone(MAIN_VARIANT_DEFAULTS[variantId] ?? MAIN_VARIANT_DEFAULTS.ready_execute);

  if (variantId === 'underspecified_execute' && AUTHORITY_SENSITIVE_TASKS.has(baseTaskId)) {
    defaults.authority_clarity = 'low';
  }

  if (split === 'neutral' && interventionState === 'guided_execute') {
    defaults.decision_ambiguity_level = 'low';
    defaults.missing_info_level = 'low';
  }

  return defaults;
}

function detectCueLeakage(text) {
  const flags = [];
  for (const pattern of CUE_PATTERNS) {
    const flagsWithGlobal = pattern.regex.flags.includes('g')
      ? pattern.regex.flags
      : `${pattern.regex.flags}g`;
    const matches = [...text.matchAll(new RegExp(pattern.regex.source, flagsWithGlobal))].map(
      (match) => match[0]
    );
    if (matches.length > 0) {
      flags.push({
        id: pattern.id,
        severity: pattern.severity,
        note: pattern.note,
        matches,
        canonical_bans: pattern.canonical_bans,
      });
    }
  }

  const priority = flags.some((flag) => flag.severity === 'high')
    ? 'high'
    : flags.some((flag) => flag.severity === 'medium')
      ? 'medium'
      : 'low';

  return {
    flags,
    priority,
  };
}

function unique(values) {
  return [...new Set(values)];
}

function buildCueBanlist({ variantId, cueAudit }) {
  const seeded = VARIANT_CUE_BANLIST[variantId] ?? [];
  const detected = cueAudit.flags.flatMap((flag) => flag.canonical_bans);
  return unique([...seeded, ...detected]);
}

function deriveManifestEntry({ caseItem, goldItem }) {
  const split =
    caseItem.slice === 'neutral_productivity_control' ? 'neutral' : 'main_affect';
  const metadata = deriveMetadataForTask(caseItem.base_task_id, split);
  const latent = deriveLatentFields({
    split,
    variantId: caseItem.variant_id,
    interventionState: goldItem.labels.intervention_state,
    baseTaskId: caseItem.base_task_id,
  });
  const combinedText = [
    ...(caseItem.history ?? []).map((entry) => entry.text ?? ''),
    caseItem.current_user_message ?? '',
  ].join('\n');
  const cueAudit = detectCueLeakage(combinedText);

  return {
    sample_id: `manifest_${caseItem.case_id}`,
    split,
    case_id: caseItem.case_id,
    base_task_id: caseItem.base_task_id,
    variant_id: caseItem.variant_id,
    slice: caseItem.slice,
    task_domain: goldItem.task_domain,
    subtemplate: metadata.subtemplate,
    source_recipe: metadata.source_recipe,
    scenario_stub: metadata.scenario_stub,
    task_context_stub: caseItem.task_context?.goal ?? null,
    contrast_anchor: caseItem.base_task_id,
    goal_clarity: latent.goal_clarity,
    authority_clarity: latent.authority_clarity,
    missing_info_level: latent.missing_info_level,
    affect_load_level: latent.affect_load_level,
    readiness_to_act_level: latent.readiness_to_act_level,
    functional_impairment_level: latent.functional_impairment_level,
    boundary_risk_level: latent.boundary_risk_level,
    decision_ambiguity_level: latent.decision_ambiguity_level,
    cue_banlist: buildCueBanlist({
      variantId: caseItem.variant_id,
      cueAudit,
    }),
    expected_label_tendency: {
      risk_level: goldItem.labels.risk_level,
      intervention_state: goldItem.labels.intervention_state,
      escalate: goldItem.labels.escalate,
    },
    manifest_origin: 'derived_from_screening_v2',
    gold_origin: 'screening_v2_existing_gold',
    thesis_review_priority: cueAudit.priority,
    leakage_flags: cueAudit.flags.map((flag) => flag.id),
    leakage_audit_status: 'pending',
    review_notes: cueAudit.flags.map((flag) => flag.note),
  };
}

function deriveManifestEntries({ caseItems, goldItems }) {
  const goldByCase = indexBy(goldItems, 'case_id', 'gold');
  return caseItems.map((caseItem) => {
    const goldItem = goldByCase.get(caseItem.case_id);
    if (!goldItem) {
      throw new Error(`Missing gold entry for case_id=${caseItem.case_id}`);
    }
    return deriveManifestEntry({ caseItem, goldItem });
  });
}

function buildSummary(entries) {
  const summary = {
    total: entries.length,
    split_counts: {},
    review_priority_counts: {},
  };

  for (const entry of entries) {
    summary.split_counts[entry.split] = (summary.split_counts[entry.split] ?? 0) + 1;
    summary.review_priority_counts[entry.thesis_review_priority] =
      (summary.review_priority_counts[entry.thesis_review_priority] ?? 0) + 1;
  }

  return summary;
}

function writeJsonl(filePath, items) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = items.map((item) => JSON.stringify(item)).join('\n') + '\n';
  fs.writeFileSync(filePath, content);
}

function printHelp() {
  console.log(`Usage:
node scripts/benchmarks/derive-affect-thesis-manifest.cjs \\
  --cases path/to/cases-a.jsonl,path/to/cases-b.jsonl \\
  --gold path/to/gold-a.jsonl,path/to/gold-b.jsonl \\
  --output research/affect-thesis/screening-v2-derived-manifest.v1.jsonl`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const caseItems = args.casesPaths.flatMap((filePath) => loadJsonl(filePath));
  const goldItems = args.goldPaths.flatMap((filePath) => loadJsonl(filePath));
  const entries = deriveManifestEntries({ caseItems, goldItems });
  writeJsonl(args.outputPath, entries);

  const summary = buildSummary(entries);
  console.log(JSON.stringify({ output: args.outputPath, ...summary }, null, 2));
}

module.exports = {
  BASE_TASK_METADATA,
  MAIN_VARIANT_DEFAULTS,
  NEUTRAL_STATE_DEFAULTS,
  CUE_PATTERNS,
  parseArgs,
  loadJsonl,
  detectCueLeakage,
  deriveLatentFields,
  deriveManifestEntry,
  deriveManifestEntries,
  buildSummary,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
