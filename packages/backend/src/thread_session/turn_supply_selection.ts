import type { ModelMessage } from 'ai';

import { startTurnHarness, type TurnDriverHarness } from '../agent/harness';
import { PiTextTurnHarness } from '../agent/runners/pi_text_turn_harness';
import { PiToolTurnHarness } from '../agent/runners/pi_tool_turn_harness';
import { supportsPiTurnSupply } from '../provider/llm/factory';
import { planToHarnessConfig, type ExecutionPlan } from './execution_plan';

const isAutonomous = (plan: ExecutionPlan): boolean =>
  Boolean(plan.autonomous && plan.autonomous.maxIterations > 1);

/**
 * The single supply-selection point for fresh tool/text turns (switch items
 * 2c/3a/3b): the Pi supply layer serves text-only turns and tool turns in
 * NON-autonomous mode; everything else — autonomous chains (handoff re-does
 * the harness mid-turn, 3c), ACP, Responses API, static-factory providers,
 * out-of-domain history — stays on the AI SDK harness until its switch item.
 * The approval policy does NOT gate: 3b wired pause + five-state resume for
 * every policy.
 */
export const selectTurnHarness = (plan: ExecutionPlan, history: ModelMessage[]): TurnDriverHarness => {
  const fallback = () => startTurnHarness(planToHarnessConfig(plan));
  const piAdmitted = supportsPiTurnSupply({
    providerType: plan.providerType,
    ...(plan.providerId ? { providerId: plan.providerId } : {}),
    modelId: plan.model,
    history,
  });
  if (!piAdmitted) return fallback();
  if (!plan.enableTools) {
    return new PiTextTurnHarness(planToHarnessConfig(plan));
  }
  if (!isAutonomous(plan)) {
    return new PiToolTurnHarness(planToHarnessConfig(plan));
  }
  return fallback();
};

/** Whether the paused plan ran on the Pi tool supply — the approval-resume
 * path's selection test. The per-request domain gate does not re-run (the
 * paused history was admitted at pause time; the resumed segment appends
 * only tool results), but the recovered history is still projected so an
 * out-of-domain surprise fails the selection, not the provider call. */
export const pausedPlanRunsOnPiToolSupply = (plan: ExecutionPlan, history: ModelMessage[]): boolean => {
  if (!plan.enableTools || isAutonomous(plan)) return false;
  return supportsPiTurnSupply({
    providerType: plan.providerType,
    ...(plan.providerId ? { providerId: plan.providerId } : {}),
    modelId: plan.model,
    history,
  });
};
