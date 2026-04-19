#!/usr/bin/env node

const fsp = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_MODE = 'end_to_end';
const DEFAULT_SEED = 20260331;
const VALID_MODES = new Set(['policy_only', 'end_to_end']);
const VALID_INTERVENTION_STATES = new Set([
  'stabilize',
  'clarify',
  'co_plan',
  'guided_execute',
  'autonomous_execute',
]);

const ensureDir = async dirPath => {
  await fsp.mkdir(dirPath, { recursive: true });
};

const parseArgs = argv => {
  const parsed = {
    mode: DEFAULT_MODE,
    seed: DEFAULT_SEED,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    const consumeValue = () => {
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      index += 1;
      return next;
    };

    switch (key) {
      case 'cases':
        parsed.casesPath = consumeValue();
        break;
      case 'gold':
        parsed.goldPath = consumeValue();
        break;
      case 'predictions':
        parsed.predictionsPath = consumeValue();
        break;
      case 'output-dir':
        parsed.outputDir = consumeValue();
        break;
      case 'mode':
        parsed.mode = consumeValue().trim();
        break;
      case 'seed':
        parsed.seed = Number.parseInt(consumeValue(), 10);
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!parsed.casesPath) throw new Error('Missing required --cases');
  if (!parsed.goldPath) throw new Error('Missing required --gold');
  if (!parsed.predictionsPath) throw new Error('Missing required --predictions');
  if (!parsed.outputDir) throw new Error('Missing required --output-dir');
  if (!VALID_MODES.has(parsed.mode)) {
    throw new Error(`Invalid --mode "${parsed.mode}". Expected one of: policy_only, end_to_end`);
  }
  if (!Number.isFinite(parsed.seed)) {
    parsed.seed = DEFAULT_SEED;
  }

  return parsed;
};

const isObjectRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeText = value => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const toBinaryFlag = (value, fieldName) => {
  if (value === 0 || value === 1) return value;
  if (value === '0' || value === '1') return Number.parseInt(value, 10);
  throw new Error(`Expected ${fieldName} to be 0 or 1`);
};

const hasStructuredContent = value => {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some(hasStructuredContent);
  if (isObjectRecord(value)) return Object.values(value).some(hasStructuredContent);
  return false;
};

const cloneJsonValue = value => JSON.parse(JSON.stringify(value));

const normalizeHistory = (value, caseId) => {
  if (!Array.isArray(value)) {
    throw new Error(`Case "${caseId}" must include history[]`);
  }

  return value.map((entry, index) => {
    if (!isObjectRecord(entry)) {
      throw new Error(`Case "${caseId}" history[${index}] is not a valid object`);
    }

    const role = normalizeText(entry.role);
    const text = normalizeText(entry.text);
    if (!role) {
      throw new Error(`Case "${caseId}" history[${index}] is missing role`);
    }
    if (!text) {
      throw new Error(`Case "${caseId}" history[${index}] is missing text`);
    }

    return { role, text };
  });
};

const normalizeTaskContext = (value, caseId) => {
  if (!isObjectRecord(value)) {
    throw new Error(`Case "${caseId}" must include task_context as an object`);
  }

  if (!hasStructuredContent(value)) {
    throw new Error(`Case "${caseId}" task_context is empty`);
  }

  return cloneJsonValue(value);
};

const normalizeCase = (entry, index) => {
  if (!isObjectRecord(entry)) {
    throw new Error(`Case ${index + 1} is not a valid object`);
  }

  const caseId = normalizeText(entry.case_id ?? entry.caseId ?? entry.id);
  if (!caseId) {
    throw new Error(`Case ${index + 1} is missing case_id`);
  }

  const currentUserMessage = normalizeText(entry.current_user_message ?? entry.currentUserMessage);
  if (!currentUserMessage) {
    throw new Error(`Case "${caseId}" is missing current_user_message`);
  }

  return {
    caseId,
    baseTaskId: normalizeText(entry.base_task_id ?? entry.baseTaskId),
    variantId: normalizeText(entry.variant_id ?? entry.variantId),
    slice: normalizeText(entry.slice),
    history: normalizeHistory(entry.history, caseId),
    currentUserMessage,
    taskContext: normalizeTaskContext(entry.task_context ?? entry.taskContext, caseId),
  };
};

const normalizeGold = (entry, index) => {
  if (!isObjectRecord(entry)) {
    throw new Error(`Gold row ${index + 1} is not a valid object`);
  }

  const caseId = normalizeText(entry.case_id ?? entry.caseId ?? entry.id);
  if (!caseId) {
    throw new Error(`Gold row ${index + 1} is missing case_id`);
  }

  const labels = isObjectRecord(entry.labels) ? entry.labels : null;
  if (!labels) {
    throw new Error(`Gold row "${caseId}" is missing labels`);
  }

  const interventionState = normalizeText(
    labels.intervention_state ?? labels.interventionState
  );
  if (!VALID_INTERVENTION_STATES.has(interventionState)) {
    throw new Error(
      `Gold row "${caseId}" has invalid intervention_state "${interventionState}"`
    );
  }

  return {
    caseId,
    baseTaskId: normalizeText(entry.base_task_id ?? entry.baseTaskId),
    variantId: normalizeText(entry.variant_id ?? entry.variantId),
    slice: normalizeText(entry.slice),
    taskDomain: normalizeText(entry.task_domain ?? entry.taskDomain),
    labels: {
      riskLevel: normalizeText(labels.risk_level ?? labels.riskLevel),
      interventionState,
      escalate: toBinaryFlag(labels.escalate, `gold "${caseId}".escalate`),
      rationale: normalizeText(labels.rationale),
    },
  };
};

const normalizePolicyAction = (value, contextLabel) => {
  if (!isObjectRecord(value)) {
    throw new Error(`${contextLabel} is missing policy_action`);
  }

  const interventionState = normalizeText(
    value.intervention_state ?? value.interventionState
  );
  if (!VALID_INTERVENTION_STATES.has(interventionState)) {
    throw new Error(
      `${contextLabel} has invalid intervention_state "${interventionState}"`
    );
  }

  return {
    interventionState,
    escalate: toBinaryFlag(value.escalate, `${contextLabel}.escalate`),
  };
};

const normalizePrediction = (entry, index, mode) => {
  if (!isObjectRecord(entry)) {
    throw new Error(`Prediction ${index + 1} is not a valid object`);
  }

  const caseId = normalizeText(entry.case_id ?? entry.caseId ?? entry.id);
  const systemId = normalizeText(entry.system_id ?? entry.systemId);
  if (!caseId) {
    throw new Error(`Prediction ${index + 1} is missing case_id`);
  }
  if (!systemId) {
    throw new Error(`Prediction "${caseId}" is missing system_id`);
  }

  const assistantResponse = normalizeText(entry.assistant_response ?? entry.assistantResponse);
  if (mode === 'end_to_end' && !assistantResponse) {
    throw new Error(`Prediction "${caseId}" from "${systemId}" is missing assistant_response`);
  }

  return {
    caseId,
    systemId,
    policyAction: normalizePolicyAction(
      entry.policy_action ?? entry.policyAction ?? entry.policy,
      `prediction "${caseId}" from "${systemId}"`
    ),
    assistantResponse,
    metadata: isObjectRecord(entry.metadata) ? entry.metadata : null,
  };
};

const readJsonLines = async filePath => {
  const absolutePath = path.resolve(filePath);
  const raw = await fsp.readFile(absolutePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
};

const writeJsonLines = async (filePath, rows) => {
  const serialized = rows.map(row => JSON.stringify(row)).join('\n');
  await fsp.writeFile(filePath, serialized ? `${serialized}\n` : '', 'utf8');
};

const stateStrength = state => {
  switch (state) {
    case 'stabilize':
      return 0;
    case 'clarify':
      return 1;
    case 'co_plan':
      return 2;
    case 'guided_execute':
      return 3;
    case 'autonomous_execute':
      return 4;
    default:
      return -1;
  }
};

const scorePolicyDecision = ({ goldLabels, predictedPolicyAction }) => {
  const stateExactMatch = Number(
    predictedPolicyAction.interventionState === goldLabels.interventionState
  );
  const escalationExactMatch = Number(
    predictedPolicyAction.escalate === goldLabels.escalate
  );

  const goldStrength = stateStrength(goldLabels.interventionState);
  const predictedStrength = stateStrength(predictedPolicyAction.interventionState);
  const policyOverIntervention = Number(predictedStrength > goldStrength);
  const policyUnderHelp = Number(predictedStrength < goldStrength);
  const escalationError = Number(predictedPolicyAction.escalate !== goldLabels.escalate);
  const policyCompositeError = Number(
    policyOverIntervention === 1 || policyUnderHelp === 1 || escalationError === 1
  );

  return {
    state_exact_match: stateExactMatch,
    escalation_exact_match: escalationExactMatch,
    policy_over_intervention: policyOverIntervention,
    policy_under_help: policyUnderHelp,
    escalation_error: escalationError,
    policy_composite_error: policyCompositeError,
    gold_state_strength: goldStrength,
    predicted_state_strength: predictedStrength,
  };
};

const buildMissingResult = ({ caseEntry, goldEntry, systemId }) => ({
  case_id: caseEntry.caseId,
  base_task_id: goldEntry.baseTaskId || caseEntry.baseTaskId || '',
  variant_id: goldEntry.variantId || caseEntry.variantId || '',
  system_id: systemId,
  slice: goldEntry.slice || caseEntry.slice || '',
  status: 'missing_prediction',
  valid_prediction: false,
  state_exact_match: 0,
  escalation_exact_match: 0,
  policy_over_intervention: 0,
  policy_under_help: 1,
  escalation_error: 0,
  policy_composite_error: 1,
  assistant_response_present: 0,
});

const scorePredictions = ({ cases, golds, predictions }) => {
  const caseById = new Map(cases.map(entry => [entry.caseId, entry]));
  const goldById = new Map(golds.map(entry => [entry.caseId, entry]));
  const predictionBySystemCase = new Map();
  const systemIds = [];
  const seenSystems = new Set();

  for (const prediction of predictions) {
    if (!caseById.has(prediction.caseId)) {
      throw new Error(`Prediction references unknown case_id "${prediction.caseId}"`);
    }
    if (!goldById.has(prediction.caseId)) {
      throw new Error(`Prediction references case_id "${prediction.caseId}" without gold labels`);
    }

    if (!seenSystems.has(prediction.systemId)) {
      seenSystems.add(prediction.systemId);
      systemIds.push(prediction.systemId);
    }

    const dedupeKey = `${prediction.systemId}::${prediction.caseId}`;
    if (predictionBySystemCase.has(dedupeKey)) {
      throw new Error(`Duplicate prediction for ${dedupeKey}`);
    }
    predictionBySystemCase.set(dedupeKey, prediction);
  }

  const results = [];
  for (const systemId of systemIds) {
    for (const goldEntry of golds) {
      const caseEntry = caseById.get(goldEntry.caseId);
      const prediction = predictionBySystemCase.get(`${systemId}::${goldEntry.caseId}`);

      if (!caseEntry) {
        throw new Error(`Missing case payload for gold case "${goldEntry.caseId}"`);
      }

      if (!prediction) {
        results.push(buildMissingResult({ caseEntry, goldEntry, systemId }));
        continue;
      }

      const policyScores = scorePolicyDecision({
        goldLabels: goldEntry.labels,
        predictedPolicyAction: prediction.policyAction,
      });

      results.push({
        case_id: goldEntry.caseId,
        base_task_id: goldEntry.baseTaskId || caseEntry.baseTaskId || '',
        variant_id: goldEntry.variantId || caseEntry.variantId || '',
        system_id: systemId,
        slice: goldEntry.slice || caseEntry.slice || '',
        status: 'ok',
        valid_prediction: true,
        assistant_response_present: Number(Boolean(prediction.assistantResponse)),
        ...policyScores,
      });
    }
  }

  return { results, systemIds, predictionBySystemCase, caseById };
};

const average = values => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const summarizeGroup = (rows, systemId, slice = '') => ({
  system_id: systemId,
  ...(slice ? { slice } : {}),
  total_cases: rows.length,
  valid_predictions: rows.filter(row => row.valid_prediction).length,
  missing_predictions: rows.filter(row => row.status === 'missing_prediction').length,
  coverage_rate: average(rows.map(row => Number(row.valid_prediction))),
  state_exact_match_rate: average(rows.map(row => row.state_exact_match)),
  escalation_exact_match_rate: average(rows.map(row => row.escalation_exact_match)),
  policy_over_intervention_rate: average(rows.map(row => row.policy_over_intervention)),
  policy_under_help_rate: average(rows.map(row => row.policy_under_help)),
  escalation_error_rate: average(rows.map(row => row.escalation_error)),
  policy_composite_error_rate: average(rows.map(row => row.policy_composite_error)),
});

const summarizeResults = ({ results, systemIds }) => {
  const overall = [];
  const slicesMap = new Map();

  for (const systemId of systemIds) {
    const systemRows = results.filter(row => row.system_id === systemId);
    overall.push(summarizeGroup(systemRows, systemId));

    const sliceNames = Array.from(
      new Set(
        systemRows
          .map(row => row.slice)
          .filter(slice => typeof slice === 'string' && slice.trim().length > 0)
      )
    ).sort();

    for (const sliceName of sliceNames) {
      const sliceRows = systemRows.filter(row => row.slice === sliceName);
      const existing = slicesMap.get(sliceName) || [];
      existing.push(summarizeGroup(sliceRows, systemId, sliceName));
      slicesMap.set(sliceName, existing);
    }
  }

  const slices = {};
  for (const [sliceName, rows] of slicesMap.entries()) {
    slices[sliceName] = rows;
  }

  return {
    overall,
    slices,
  };
};

const hashStringToSeed = value => {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createMulberry32 = seed => {
  let current = seed >>> 0;
  return () => {
    current += 0x6d2b79f5;
    let t = current;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffleDeterministic = (items, seed) => {
  const output = [...items];
  const random = createMulberry32(seed);
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
};

const buildJudgePackets = ({ cases, golds, predictionBySystemCase, systemIds, seed, mode }) => {
  if (mode !== 'end_to_end') {
    return { judgeItems: [], judgeKey: [] };
  }

  const caseById = new Map(cases.map(entry => [entry.caseId, entry]));
  const judgeItems = [];
  const judgeKey = [];
  let counter = 0;

  for (const goldEntry of golds) {
    const caseEntry = caseById.get(goldEntry.caseId);
    if (!caseEntry) continue;

    const available = systemIds
      .map(systemId => predictionBySystemCase.get(`${systemId}::${goldEntry.caseId}`))
      .filter(
        prediction =>
          prediction &&
          typeof prediction.assistantResponse === 'string' &&
          prediction.assistantResponse.trim().length > 0
      );

    const shuffleSeed = hashStringToSeed(`${seed}:${goldEntry.caseId}`);
    const shuffled = shuffleDeterministic(available, shuffleSeed);

    shuffled.forEach((prediction, index) => {
      counter += 1;
      const judgeItemId = `judge_${String(counter).padStart(6, '0')}`;
      const blindSlotId = `slot_${String(index + 1).padStart(2, '0')}`;

      judgeItems.push({
        judge_item_id: judgeItemId,
        case_id: goldEntry.caseId,
        base_task_id: goldEntry.baseTaskId || caseEntry.baseTaskId || '',
        variant_id: goldEntry.variantId || caseEntry.variantId || '',
        blind_slot_id: blindSlotId,
        case: {
          history: caseEntry.history,
          current_user_message: caseEntry.currentUserMessage,
          task_context: caseEntry.taskContext,
        },
        assistant_response: prediction.assistantResponse,
      });

      judgeKey.push({
        judge_item_id: judgeItemId,
        case_id: goldEntry.caseId,
        blind_slot_id: blindSlotId,
        system_id: prediction.systemId,
      });
    });
  }

  return { judgeItems, judgeKey };
};

const assertUniqueIds = (entries, fieldName, label) => {
  const seen = new Set();
  for (const entry of entries) {
    const value = entry[fieldName];
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label} "${value}"`);
    }
    seen.add(value);
  }
};

const main = async argv => {
  const options = parseArgs(argv);
  const cases = (await readJsonLines(options.casesPath)).map(normalizeCase);
  const golds = (await readJsonLines(options.goldPath)).map(normalizeGold);
  const predictions = (await readJsonLines(options.predictionsPath)).map((entry, index) =>
    normalizePrediction(entry, index, options.mode)
  );

  assertUniqueIds(cases, 'caseId', 'case_id in cases');
  assertUniqueIds(golds, 'caseId', 'case_id in gold');

  const caseIds = new Set(cases.map(entry => entry.caseId));
  for (const goldEntry of golds) {
    if (!caseIds.has(goldEntry.caseId)) {
      throw new Error(`Gold references unknown case_id "${goldEntry.caseId}"`);
    }
  }

  const { results, systemIds, predictionBySystemCase } = scorePredictions({
    cases,
    golds,
    predictions,
  });
  const summary = summarizeResults({ results, systemIds });
  const { judgeItems, judgeKey } = buildJudgePackets({
    cases,
    golds,
    predictionBySystemCase,
    systemIds,
    seed: options.seed,
    mode: options.mode,
  });

  const outputDir = path.resolve(options.outputDir);
  await ensureDir(outputDir);
  await fsp.writeFile(
    path.join(outputDir, 'results.json'),
    JSON.stringify({ mode: options.mode, results }, null, 2),
    'utf8'
  );
  await fsp.writeFile(
    path.join(outputDir, 'summary.json'),
    JSON.stringify(
      {
        mode: options.mode,
        generated_at: new Date().toISOString(),
        total_cases: golds.length,
        system_ids: systemIds,
        ...summary,
      },
      null,
      2
    ),
    'utf8'
  );
  await writeJsonLines(path.join(outputDir, 'judge_input.jsonl'), judgeItems);
  await writeJsonLines(path.join(outputDir, 'judge_key.jsonl'), judgeKey);

  console.log(
    JSON.stringify(
      {
        success: true,
        mode: options.mode,
        totalCases: golds.length,
        systems: systemIds,
        outputDir,
        judgeItems: judgeItems.length,
      },
      null,
      2
    )
  );
};

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MODE,
  DEFAULT_SEED,
  VALID_INTERVENTION_STATES,
  parseArgs,
  normalizeCase,
  normalizeGold,
  normalizePrediction,
  scorePolicyDecision,
  scorePredictions,
  summarizeResults,
  buildJudgePackets,
  hashStringToSeed,
  shuffleDeterministic,
};
