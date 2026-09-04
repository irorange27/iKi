import { DEFAULT_APP_CONFIG } from '@iki/backend/config/defaults';
import type { ModelCapability } from '@iki/backend/utils/provider_models';

type ContextConfig = typeof DEFAULT_APP_CONFIG.memory.context;

type ScaledBudgetItem = {
  key:
    | 'maxRecentTokens'
    | 'maxIdentityTokens'
    | 'maxSummaryTokens'
    | 'maxMemoryTokens'
    | 'maxSkillTokens';
  value: number;
  minValue: number;
};

export type EffectiveContextConfig = ContextConfig & {
  budgetScale: number;
  availableContextTokens: number | null;
  requestedContextTokens: number;
  maxOutputTokens: number | null;
  modelContextWindow: number | null;
  modelInputLimit: number | null;
};

const CONTEXT_BUDGET_FLOORS: Record<ScaledBudgetItem['key'], number> = {
  maxRecentTokens: 256,
  maxIdentityTokens: 48,
  maxSummaryTokens: 96,
  maxMemoryTokens: 96,
  maxSkillTokens: 160,
};

const clampInteger = (value: number, minValue: number, maxValue: number): number =>
  Math.max(minValue, Math.min(maxValue, Math.trunc(value)));

const toScaledBudgetItems = (config: ContextConfig): ScaledBudgetItem[] => [
  {
    key: 'maxRecentTokens',
    value: config.maxRecentTokens,
    minValue: CONTEXT_BUDGET_FLOORS.maxRecentTokens,
  },
  {
    key: 'maxIdentityTokens',
    value: config.maxIdentityTokens,
    minValue: CONTEXT_BUDGET_FLOORS.maxIdentityTokens,
  },
  {
    key: 'maxSummaryTokens',
    value: config.maxSummaryTokens,
    minValue: CONTEXT_BUDGET_FLOORS.maxSummaryTokens,
  },
  {
    key: 'maxMemoryTokens',
    value: config.maxMemoryTokens,
    minValue: CONTEXT_BUDGET_FLOORS.maxMemoryTokens,
  },
  {
    key: 'maxSkillTokens',
    value: config.maxSkillTokens,
    minValue: CONTEXT_BUDGET_FLOORS.maxSkillTokens,
  },
];

const sumBudgetItems = (items: ScaledBudgetItem[]): number =>
  items.reduce((sum, item) => sum + item.value, 0);

const shrinkBudgetToFit = (
  items: ScaledBudgetItem[],
  availableContextTokens: number
): ScaledBudgetItem[] => {
  let remainingOverflow = Math.max(0, sumBudgetItems(items) - availableContextTokens);
  if (remainingOverflow <= 0) return items;

  const nextItems = items.map(item => ({ ...item }));

  while (remainingOverflow > 0) {
    const adjustableItems = nextItems
      .filter(item => item.value > item.minValue)
      .sort((left, right) => right.value - left.value);
    if (adjustableItems.length === 0) {
      break;
    }

    const totalHeadroom = adjustableItems.reduce(
      (sum, item) => sum + (item.value - item.minValue),
      0
    );
    if (totalHeadroom <= 0) {
      break;
    }

    for (const item of adjustableItems) {
      if (remainingOverflow <= 0) break;

      const headroom = item.value - item.minValue;
      if (headroom <= 0) continue;

      const proportionalCut = Math.ceil((headroom / totalHeadroom) * remainingOverflow);
      const reduction = Math.min(headroom, Math.max(1, proportionalCut), remainingOverflow);
      item.value -= reduction;
      remainingOverflow -= reduction;
    }
  }

  return nextItems;
};

const buildRequestedContextTokens = (config: ContextConfig): number =>
  config.maxRecentTokens +
  config.maxIdentityTokens +
  config.maxSummaryTokens +
  config.maxMemoryTokens +
  config.maxSkillTokens;

const resolveMaxOutputTokens = (
  modelInputLimit: number,
  capability?: ModelCapability | null
): number => {
  const declaredOutput = capability?.maxOutputTokens ?? null;
  if (declaredOutput && declaredOutput > 0) {
    return clampInteger(declaredOutput, 256, Math.max(256, Math.floor(modelInputLimit / 2)));
  }

  return clampInteger(Math.floor(modelInputLimit * 0.2), 512, 2048);
};

const scaleMessageClipBudget = (
  config: ContextConfig,
  scale: number,
  maxRecentTokens: number
): number => {
  if (scale >= 1) {
    return Math.min(config.maxMessageTokens, maxRecentTokens);
  }

  return Math.min(
    maxRecentTokens,
    clampInteger(
      Math.floor(config.maxMessageTokens * Math.max(scale, 0.5)),
      80,
      config.maxMessageTokens
    )
  );
};

export const deriveModelAwareContextConfig = (
  config: ContextConfig,
  capability?: ModelCapability | null
): EffectiveContextConfig => {
  const requestedContextTokens = buildRequestedContextTokens(config);
  const modelInputLimit = capability?.maxInputTokens ?? capability?.contextWindow ?? null;
  const modelContextWindow = capability?.contextWindow ?? null;

  if (!modelInputLimit || modelInputLimit <= 0) {
    return {
      ...config,
      budgetScale: 1,
      availableContextTokens: null,
      requestedContextTokens,
      maxOutputTokens: null,
      modelContextWindow,
      modelInputLimit,
    };
  }

  const maxOutputTokens = resolveMaxOutputTokens(modelInputLimit, capability);
  const safetyReserveTokens = clampInteger(Math.floor(modelInputLimit * 0.05), 128, 1024);
  const availableContextTokens = Math.max(
    CONTEXT_BUDGET_FLOORS.maxRecentTokens,
    modelInputLimit - maxOutputTokens - safetyReserveTokens
  );

  if (availableContextTokens >= requestedContextTokens) {
    return {
      ...config,
      budgetScale: 1,
      availableContextTokens,
      requestedContextTokens,
      maxOutputTokens,
      modelContextWindow,
      modelInputLimit,
    };
  }

  const requestedItems = toScaledBudgetItems(config);
  const scale = availableContextTokens / Math.max(1, requestedContextTokens);
  const scaledItems = requestedItems.map(item => ({
    ...item,
    value:
      scale >= 1
        ? item.value
        : clampInteger(Math.floor(item.value * scale), item.minValue, item.value),
  }));
  const fittedItems = shrinkBudgetToFit(scaledItems, availableContextTokens);
  const itemMap = Object.fromEntries(fittedItems.map(item => [item.key, item.value])) as Record<
    ScaledBudgetItem['key'],
    number
  >;

  return {
    ...config,
    maxRecentTokens: itemMap.maxRecentTokens,
    maxMessageTokens: scaleMessageClipBudget(config, scale, itemMap.maxRecentTokens),
    maxIdentityTokens: itemMap.maxIdentityTokens,
    maxSummaryTokens: itemMap.maxSummaryTokens,
    maxMemoryTokens: itemMap.maxMemoryTokens,
    maxSkillTokens: itemMap.maxSkillTokens,
    budgetScale: scale,
    availableContextTokens,
    requestedContextTokens,
    maxOutputTokens,
    modelContextWindow,
    modelInputLimit,
  };
};
