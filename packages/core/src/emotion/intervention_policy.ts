import { extractTextFromModelMessageContent } from '../agent/model_messages';
import type { AffectState } from './affect_state';
import type {
  InterventionPolicySignal,
  InterventionState,
} from '../chat/intervention_policy';

type PolicyMessage = {
  role?: string;
  content?: unknown;
};

type DeriveInterventionPolicyParams = {
  messages: PolicyMessage[];
  affectState?: AffectState | null;
};

type DecisionContext = {
  latestUserText: string;
  recentUserText: string;
  latestSystemText: string;
  combinedContextText: string;
};

const normalizeText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return extractTextFromModelMessageContent(value).trim();
  }
  return '';
};

const uniq = (values: string[]): string[] => {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
};

const countConcreteDetailSignals = (text: string): number => {
  let score = 0;
  if (/[0-9]/.test(text)) score += 1;
  if (/[,:;，。：；]/.test(text)) score += 1;
  if (/\b(today|tomorrow|manager|slack|email|issue|deadline|ETA|dashboard|review|reply)\b/i.test(text)) {
    score += 1;
  }
  if (/(今天|明天|经理|邮件|Slack|工单|deadline|截止|回复|总结|计划|草稿|需求|约束)/.test(text)) {
    score += 1;
  }
  return score;
};

const collectDecisionContext = (messages: PolicyMessage[]): DecisionContext => {
  const userTexts = messages
    .filter(message => message?.role === 'user')
    .map(message => normalizeText(message.content))
    .filter(Boolean);
  const systemTexts = messages
    .filter(message => message?.role === 'system')
    .map(message => normalizeText(message.content))
    .filter(Boolean);

  const latestUserText = userTexts.at(-1) ?? '';
  const recentUserText = userTexts.slice(-3).join('\n');
  const latestSystemText = systemTexts.at(-1) ?? '';
  const combinedContextText = [...systemTexts.slice(-2), ...userTexts.slice(-3)].join('\n');

  return {
    latestUserText,
    recentUserText,
    latestSystemText,
    combinedContextText,
  };
};

const hasAnyPattern = (text: string, patterns: RegExp[]): boolean =>
  patterns.some(pattern => pattern.test(text));

const DIRECT_EXECUTION_PATTERNS = [
  /\b(directly|just|please)\s+(write|draft|reply|send|summarize|produce)\b/i,
  /\b(write|draft|reply|send)\s+(the|a)\b/i,
  /直接(帮我)?(写|回|整理|总结|生成|做)/,
  /帮我(写|回|起草|整理|总结|生成)/,
];

const GUIDED_REQUEST_PATTERNS = [
  /\b(step|steps|plan|outline|checklist|framework|breakdown)\b/i,
  /(步骤|计划|大纲|清单|拆解|框架|下一步)/,
];

const CLARIFY_PATTERNS = [
  /\b(not sure|unsure|haven't decided|don't decide|don't write yet|need to figure out)\b/i,
  /(没想清楚|不确定|还没决定|先别|不要先|不知道该|我也没想清楚|别替我)/,
];

const BLOCKED_AFFECT_PATTERNS = [
  /\b(ashamed|shame|avoid|avoiding|freeze|frozen|anxious|panic|spiral|stuck)\b/i,
  /(羞耻|羞愧|不敢|回避|逃避|焦虑|慌|卡住|崩|自责|害怕)/,
];

const CRISIS_PATTERNS = [
  /\b(self-harm|hurt myself|can't breathe|panic attack|unsafe|want to die)\b/i,
  /(伤害自己|不想活|想死|喘不过气|惊恐发作|失控|撑不住)/,
];

const BOUNDARY_TASK_PATTERNS = [
  /\b(stabili[sz]e|trusted human|offline support|human support|major decision)\b/i,
  /(明显失稳状态|优先稳定状态|转向真人支持|真人支持|持续陪伴|替代真人支持|重大(?:人生)?决定)/,
];

const FUNCTIONAL_IMPAIRMENT_PATTERNS = [
  /\b(can't think|cannot think|can't decide|cannot decide|can't calm down|can't handle this alone|not in a state to decide)\b/i,
  /(组织不起来|很难自己把状态稳下来|缓不过来|发懵|没法正常(?:想事情|判断)|判断不好|不是能正常.*状态|不像能正常做重大决定的人|不适合继续(?:独自)?处理|不适合继续做|不适合继续硬顶|不适合继续把.*往下推|不适合自己做这个决定|一个人硬撑)/,
];

const PHYSIOLOGICAL_DISTRESS_PATTERNS = [
  /\b(hardly slept|haven't slept|can't eat|not eating)\b/i,
  /(几乎没睡|基本没怎么睡|吃不下|饭也吃不下|吃饭和休息都很乱)/,
];

const AMBIGUOUS_DECISION_PATTERNS = [
  /\b(should i|whether to|or should i)\b/i,
  /(到底该|还是|要不要|不知道是|不确定是)/,
];

const buildRationale = (state: InterventionState, reasons: string[]): string => {
  const reasonText = uniq(reasons).join(', ');
  switch (state) {
    case 'stabilize':
      return `User state appears too dysregulated for direct task pushing; prioritize stabilization first. ${reasonText}`.trim();
    case 'clarify':
      return `Key task intent or decision boundary is still underspecified; clarify before acting. ${reasonText}`.trim();
    case 'co_plan':
      return `Task direction is mostly known, but the user appears affect-blocked; co-plan a lower-pressure next step. ${reasonText}`.trim();
    case 'guided_execute':
      return `The task is concrete enough for structured help, but visible collaboration remains useful. ${reasonText}`.trim();
    case 'autonomous_execute':
      return `The user appears ready and the artifact request is sufficiently specified for direct execution. ${reasonText}`.trim();
  }
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const deriveInterventionPolicy = (
  params: DeriveInterventionPolicyParams
): InterventionPolicySignal => {
  const context = collectDecisionContext(params.messages);

  const hasDirectExecutionRequest = hasAnyPattern(context.latestUserText, DIRECT_EXECUTION_PATTERNS);
  const hasGuidedRequest = hasAnyPattern(context.latestUserText, GUIDED_REQUEST_PATTERNS);
  const hasClarifySignal =
    hasAnyPattern(context.latestUserText, CLARIFY_PATTERNS) ||
    hasAnyPattern(context.recentUserText, AMBIGUOUS_DECISION_PATTERNS);
  const blockedByAffect =
    hasAnyPattern(context.combinedContextText, BLOCKED_AFFECT_PATTERNS) ||
    Boolean(params.affectState) &&
      (params.affectState?.valence ?? 0) <= -0.35 &&
      (params.affectState?.arousal ?? 0) >= 0.45;
  const crisisLike = hasAnyPattern(context.combinedContextText, CRISIS_PATTERNS);
  const structuredTaskContext =
    /\b(goal|deliverable|constraints?)\b/i.test(context.latestSystemText) ||
    /(目标|交付物|约束|要求)/.test(context.latestSystemText);
  const detailSignals = countConcreteDetailSignals(context.combinedContextText);
  const taskIsConcrete =
    structuredTaskContext ||
    detailSignals >= 2 ||
    (hasDirectExecutionRequest && context.combinedContextText.length >= 120);
  const highDistress =
    Boolean(params.affectState) &&
    (params.affectState?.confidence ?? 0) >= 0.45 &&
    (params.affectState?.valence ?? 0) <= -0.6 &&
    (params.affectState?.arousal ?? 0) >= 0.7;
  const boundarySensitiveTask = hasAnyPattern(context.latestSystemText, BOUNDARY_TASK_PATTERNS);
  const functionalImpairment = hasAnyPattern(
    context.combinedContextText,
    FUNCTIONAL_IMPAIRMENT_PATTERNS
  );
  const physiologicalDistress = hasAnyPattern(
    context.combinedContextText,
    PHYSIOLOGICAL_DISTRESS_PATTERNS
  );
  const boundaryImpairment = functionalImpairment || physiologicalDistress;
  const affectCorroboratesBoundary =
    Boolean(params.affectState) &&
    (params.affectState?.confidence ?? 0) >= 0.45 &&
    (((params.affectState?.valence ?? 0) <= -0.35 &&
      (params.affectState?.arousal ?? 0) >= 0.45) ||
      highDistress);
  const boundaryEscalation = boundarySensitiveTask && boundaryImpairment && affectCorroboratesBoundary;

  const reasonCodes: string[] = [];
  let interventionState: InterventionState = 'guided_execute';
  let escalate: 0 | 1 = 0;

  if (
    crisisLike ||
    boundaryEscalation ||
    (highDistress && /panic|失控|撑不住|崩/.test(context.combinedContextText))
  ) {
    interventionState = 'stabilize';
    escalate = 1;
    reasonCodes.push('boundary_risk');
    if (boundarySensitiveTask) reasonCodes.push('boundary_task_context');
    if (boundaryImpairment) reasonCodes.push('functional_impairment');
  } else if (hasClarifySignal || (hasDirectExecutionRequest && !taskIsConcrete)) {
    interventionState = 'clarify';
    reasonCodes.push('missing_decision_or_info');
  } else if (blockedByAffect && taskIsConcrete) {
    interventionState = 'co_plan';
    reasonCodes.push('affect_blocked');
  } else if (hasGuidedRequest) {
    interventionState = 'guided_execute';
    reasonCodes.push('guided_request');
  } else if (hasDirectExecutionRequest && taskIsConcrete) {
    interventionState = 'autonomous_execute';
    reasonCodes.push('explicit_execution_request');
  } else if (!taskIsConcrete) {
    interventionState = 'clarify';
    reasonCodes.push('task_not_concrete');
  } else {
    interventionState = 'guided_execute';
    reasonCodes.push('structured_help_default');
  }

  if (blockedByAffect && interventionState === 'autonomous_execute') {
    interventionState = 'co_plan';
    reasonCodes.push('affect_softens_autonomy');
  }

  if (highDistress && interventionState !== 'stabilize') {
    reasonCodes.push('high_distress');
  }

  const confidenceBase =
    interventionState === 'stabilize'
      ? 0.9
      : interventionState === 'clarify'
        ? 0.8
        : interventionState === 'co_plan'
          ? 0.78
          : interventionState === 'autonomous_execute'
            ? 0.82
            : 0.76;
  const confidenceBonus = Math.min(0.12, uniq(reasonCodes).length * 0.03);

  return {
    interventionState,
    escalate,
    confidence: clamp(confidenceBase + confidenceBonus, 0, 0.98),
    rationale: buildRationale(interventionState, reasonCodes),
    reasonCodes: uniq(reasonCodes),
    affectUsed: Boolean(params.affectState),
  };
};

export const buildInterventionPolicySystemMessage = (
  signal: InterventionPolicySignal
): string => {
  const escalationLine =
    signal.escalate === 1
      ? 'Escalation is required: explicitly redirect toward trusted human or offline support.'
      : 'Escalation is not required for this turn.';

  return [
    'Turn intervention policy:',
    `- intervention_state: ${signal.interventionState}`,
    `- escalate: ${signal.escalate}`,
    `- confidence: ${signal.confidence.toFixed(2)}`,
    `- rationale: ${signal.rationale}`,
    escalationLine,
    'Follow this policy exactly when deciding how strongly to intervene.',
    'Mode definitions:',
    '- stabilize: lower pressure, ground the user, do not push execution.',
    '- clarify: ask only for the missing decision or missing task information.',
    '- co_plan: co-design one low-pressure next step instead of directly executing the full task.',
    '- guided_execute: provide structured steps or a partial artifact while staying collaborative.',
    '- autonomous_execute: directly produce the requested artifact when scope and authorization are clear.',
  ].join('\n');
};

// ── Hard tool blocking by intervention state ──

type ToolRiskCategory = 'readonly' | 'write' | 'shell' | 'agent';

const ALWAYS_ALLOWED_TOOLS = new Set([
  'handoff',
  'plan',
  'todo',
  'load_skill',
]);

const TOOL_RISK_CATEGORY: Record<string, ToolRiskCategory> = {
  // file tools
  read_file: 'readonly',
  list_dir: 'readonly',
  write_file: 'write',
  edit: 'write',
  delete_file: 'write',
  // web tools
  web: 'readonly',
  fetch: 'readonly',
  // shell
  shell: 'shell',
  // agent delegation
  agent: 'agent',
  // skill tools
  list_personal_skills: 'readonly',
  read_personal_skill: 'readonly',
  write_personal_skill: 'write',
  delete_personal_skill: 'write',
  // todo tools
  list_todo_lists: 'readonly',
  read_todo_list: 'readonly',
  write_todo_list: 'write',
  delete_todo_list: 'write',
  // awaiter tools
  list_awaiters: 'readonly',
  read_awaiter: 'readonly',
  write_awaiter: 'write',
  delete_awaiter: 'write',
  // proactive task tools
  list_proactive_tasks: 'readonly',
  read_proactive_task: 'readonly',
  write_proactive_task: 'write',
  delete_proactive_task: 'write',
};

const BLOCKED_CATEGORIES_BY_STATE: Record<InterventionState, Set<ToolRiskCategory>> = {
  stabilize: new Set(['shell', 'write', 'agent']),
  clarify: new Set(['shell', 'write']),
  co_plan: new Set(['shell', 'write']),
  guided_execute: new Set([]),
  autonomous_execute: new Set([]),
};

/**
 * Remove tools whose risk category is blocked under the current intervention state.
 * Only applies when the policy is explicitly active (explicit_policy condition).
 * Unknown tools and administrative tools (finish, handoff, etc.) always pass through.
 */
export const filterToolsByInterventionState = (
  toolNames: string[],
  state: InterventionState,
  policyApplied: boolean
): string[] => {
  if (!policyApplied) return toolNames;

  const blocked = BLOCKED_CATEGORIES_BY_STATE[state];
  if (!blocked || blocked.size === 0) return toolNames;

  return toolNames.filter(name => {
    if (ALWAYS_ALLOWED_TOOLS.has(name)) return true;
    const category = TOOL_RISK_CATEGORY[name];
    if (!category) return true; // unknown / MCP tools pass through (conservative: they have their own approval)
    return !blocked.has(category);
  });
};
