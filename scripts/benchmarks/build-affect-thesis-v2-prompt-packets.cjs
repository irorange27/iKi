#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  manifestPath: 'research/affect-thesis-v2/dataset-manifest.v1.jsonl',
  promptsPath: 'research/affect-thesis-v2/generation-prompts.v1.json',
  outputPath: 'research/affect-thesis-v2/authoring-packets.v1.jsonl',
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
    if (arg === '--prompts') {
      args.promptsPath = argv[index + 1] ?? args.promptsPath;
      index += 1;
      continue;
    }
    if (arg === '--output') {
      args.outputPath = argv[index + 1] ?? args.outputPath;
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

function renderPromptPacket(row, prompts) {
  const splitInstructions =
    prompts.split_specific_instructions?.[row.split] ??
    prompts.split_specific_instructions?.[
      row.split === 'neutral_control' ? 'neutral_control' : 'main_affect'
    ] ??
    [];
  const packetPreamble =
    row.split === 'neutral_control'
      ? prompts.render_notes.neutral_control_packet_template
      : prompts.render_notes.main_affect_packet_template;

  const userPrompt = [
    packetPreamble,
    '',
    `sample_id: ${row.sample_id}`,
    `case_id: ${row.case_id}`,
    `split: ${row.split}`,
    `base_task_id: ${row.base_task_id}`,
    `variant_id: ${row.variant_id}`,
    `slice: ${row.slice}`,
    `task_domain: ${row.task_domain}`,
    `subtemplate: ${row.subtemplate}`,
    `source_recipe: ${row.source_recipe}`,
    `scenario_stub: ${row.scenario_stub}`,
    `writer_intent: ${row.writer_intent}`,
    '',
    '潜变量约束：',
    `- goal_clarity: ${row.goal_clarity}`,
    `- authority_clarity: ${row.authority_clarity}`,
    `- missing_info_level: ${row.missing_info_level}`,
    `- affect_load_level: ${row.affect_load_level}`,
    `- readiness_to_act_level: ${row.readiness_to_act_level}`,
    `- functional_impairment_level: ${row.functional_impairment_level}`,
    `- boundary_risk_level: ${row.boundary_risk_level}`,
    `- decision_ambiguity_level: ${row.decision_ambiguity_level}`,
    '',
    'task_context 写作锚点：',
    `- goal: ${row.task_context_stub}`,
    `- deliverable: ${row.task_context_deliverable_stub}`,
    `- constraints: ${(row.task_context_constraints_stub ?? []).join(' | ')}`,
    '',
    'gold 仅用于构造，不得直接泄漏到文本：',
    `- risk_level: ${row.expected_label_tendency.risk_level}`,
    `- intervention_state: ${row.expected_label_tendency.intervention_state}`,
    `- escalate: ${row.expected_label_tendency.escalate}`,
    `- rationale_stub: ${row.expected_label_tendency.rationale_stub}`,
    '',
    `candidate_quota: ${row.candidate_quota}`,
    `cue_banlist: ${(row.cue_banlist ?? []).join(' | ') || '(none)'}`,
    '',
    'split 专用要求：',
    ...splitInstructions.map((entry) => `- ${entry}`),
    '',
    'writer checklist：',
    ...prompts.writer_checklist.map((entry) => `- ${entry}`),
    '',
    '输出要求：',
    '- 返回一个 JSON object。',
    '- 顶层字段必须是 sample_id 和 candidates。',
    `- candidates 数量必须等于 ${row.candidate_quota}。`,
    '- 每个 candidate 必须包含 candidate_id、history、current_user_message、task_context、author_notes。',
    '- history 里的 message 只允许 role=user 或 assistant，字段名必须是 role 和 text。',
    '- task_context 必须包含 goal、deliverable、constraints。',
    '- 候选文本默认使用中文；必要的产品或技术名可以保留英文。',
  ].join('\n');

  return {
    packet_id: `packet_${row.sample_id}`,
    sample_id: row.sample_id,
    case_id: row.case_id,
    split: row.split,
    candidate_quota: row.candidate_quota,
    generation_template_id: row.generation_template_id,
    system_prompt: prompts.shared_system_prompt,
    user_prompt: userPrompt,
    output_contract: prompts.output_contract,
    writer_checklist: prompts.writer_checklist,
    cue_banlist: row.cue_banlist,
  };
}

function buildPromptPackets(rows, prompts) {
  return rows.map((row) => renderPromptPacket(row, prompts));
}

function printHelp() {
  console.log(`Usage:
node scripts/benchmarks/build-affect-thesis-v2-prompt-packets.cjs \\
  --manifest research/affect-thesis-v2/dataset-manifest.v1.jsonl \\
  --prompts research/affect-thesis-v2/generation-prompts.v1.json \\
  --output research/affect-thesis-v2/authoring-packets.v1.jsonl`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const rows = loadJsonl(args.manifestPath);
  const prompts = loadJson(args.promptsPath);
  const packets = buildPromptPackets(rows, prompts);
  writeJsonl(args.outputPath, packets);

  console.log(
    JSON.stringify(
      {
        output: args.outputPath,
        packet_count: packets.length,
      },
      null,
      2
    )
  );
}

module.exports = {
  DEFAULTS,
  parseArgs,
  renderPromptPacket,
  buildPromptPackets,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
