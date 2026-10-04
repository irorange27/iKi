import type { ModelMessage } from 'ai';

import { startTurnHarness, type TurnDriverHarness } from '../agent/harness';
import { PiTextTurnHarness } from '../agent/runners/pi_text_turn_harness';
import { PiToolTurnHarness } from '../agent/runners/pi_tool_turn_harness';
import { supportsPiTurnSupply } from '../provider/llm/factory';
import { planToHarnessConfig, type ExecutionPlan } from './execution_plan';

/**
 * The single supply-selection point for fresh tool/text turns and handoff-
 * chain rebuilds (switch items 2c/3a/3b/3c): the Pi supply layer serves
 * text-only turns and tool turns in EVERY mode — autonomous batch
 * continuation and handoff chains included, the outer loop rebuilding each
 * chained harness through this same selector. Everything else — ACP,
 * Responses API, static-factory providers, out-of-domain history — stays on
 * the AI SDK harness until its switch item. The approval policy does NOT
 * gate: pause + five-state resume serve every policy (3b).
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
  return new PiToolTurnHarness(planToHarnessConfig(plan));
};

/** Whether the paused plan ran on the Pi tool supply — the approval-resume
 * path's selection test. The per-request domain gate does not re-run (the
 * paused history was admitted at pause time; the resumed segment appends
 * only tool results), but the recovered history is still projected so an
 * out-of-domain surprise fails the selection, not the provider call. Mode
 * does not gate either: an autonomous pause must resume on the supply it
 * paused on, or the supply flips mid-turn. */
export const pausedPlanRunsOnPiToolSupply = (plan: ExecutionPlan, history: ModelMessage[]): boolean => {
  if (!plan.enableTools) return false;
  return supportsPiTurnSupply({
    providerType: plan.providerType,
    ...(plan.providerId ? { providerId: plan.providerId } : {}),
    modelId: plan.model,
    history,
  });
};
