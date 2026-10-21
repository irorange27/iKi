import type { ModelMessage } from '../message/model_history';

import { type TurnDriverHarness } from '../agent/harness';
import { PiTextTurnHarness } from '../agent/runners/pi_text_turn_harness';
import { PiToolTurnHarness } from '../agent/runners/pi_tool_turn_harness';
import { resolvePiTurnSupply } from '../provider/llm/factory';
import { planToHarnessConfig, type ExecutionPlan } from './execution_plan';

export type TurnHarnessOverride = (plan: ExecutionPlan) => TurnDriverHarness | null;

export const piTurnHarness: TurnHarnessOverride = plan =>
  plan.enableTools
    ? new PiToolTurnHarness(planToHarnessConfig(plan))
    : new PiTextTurnHarness(planToHarnessConfig(plan));

let fallbackExecutor: TurnHarnessOverride | null = null;

export const setTurnHarnessFallback = (override: TurnHarnessOverride | null): void => {
  fallbackExecutor = override;
};

export const selectTurnHarness = (
  plan: ExecutionPlan,
  history: ModelMessage[],
  override?: TurnHarnessOverride
): TurnDriverHarness => {
  const forced = (override ?? fallbackExecutor)?.(plan) ?? null;
  if (forced) return forced;

  const decision = resolvePiTurnSupply({
    providerType: plan.providerType,
    ...(plan.providerId ? { providerId: plan.providerId } : {}),
    modelId: plan.model,
    history,
  });
  if (!decision.admitted) {
    throw new PiSupplyRefusedError(decision.reason, decision.cause, {
      providerType: plan.providerType,
      providerId: plan.providerId ?? null,
      model: plan.model,
    });
  }
  if (!plan.enableTools) {
    return new PiTextTurnHarness(planToHarnessConfig(plan));
  }
  return new PiToolTurnHarness(planToHarnessConfig(plan));
};

export class PiSupplyRefusedError extends Error {
  constructor(
    readonly reason: string,
    readonly refusalCause: 'config' | 'domain',
    readonly context: { providerType: string; providerId: string | null; model: string }
  ) {
    super(
      refusalCause === 'domain'
        ? `This turn cannot be sent: its history contains content the model projection does not support (${reason}). Nothing was sent — remove or resend the offending message.`
        : `This turn cannot be sent: ${reason}.`
    );
    this.name = 'PiSupplyRefusedError';
  }
}

export const piDomainResumeHistory = (history: ModelMessage[]): ModelMessage[] => {
  let changed = false;
  const projected = history.map(message => {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) return message;
    const parts = message.content.filter(
      part => (part as { type?: string }).type !== 'tool-approval-request'
    );
    if (parts.length === message.content.length) return message;
    changed = true;
    return { ...message, content: parts };
  });
  return changed ? projected : history;
};

export const pausedPlanRunsOnPiToolSupply = (
  plan: ExecutionPlan,
  history: ModelMessage[]
): boolean => {
  if (!plan.enableTools) return false;
  return resolvePiTurnSupply({
    providerType: plan.providerType,
    ...(plan.providerId ? { providerId: plan.providerId } : {}),
    modelId: plan.model,
    history: piDomainResumeHistory(history),
  }).admitted;
};
