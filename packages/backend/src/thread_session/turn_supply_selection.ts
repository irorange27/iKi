import type { ModelMessage } from '../message/model_history';

import { type TurnDriverHarness } from '../agent/harness';
import { PiTextTurnHarness } from '../agent/runners/pi_text_turn_harness';
import { PiToolTurnHarness } from '../agent/runners/pi_tool_turn_harness';
import { resolvePiTurnSupply } from '../provider/llm/factory';
import { planToHarnessConfig, type ExecutionPlan } from './execution_plan';
import { todoReminderFor } from './todo_reminder';

/**
 * The single supply-selection point for fresh tool/text turns and handoff-
 * chain rebuilds (switch items 2c/3a/3b/3c): the Pi supply layer serves
 * text-only turns and tool turns in EVERY mode — autonomous batch
 * continuation and handoff chains included, the turn driver rebuilding each
 * chained harness through this same selector. The approval policy does NOT
 * gate: pause + five-state resume serve every policy (3b).
 *
 * REFUSAL IS LOUD. When the Pi projection cannot represent the history, the
 * turn fails with the offending part named instead of quietly running on a
 * different executor. The silent re-route was the last thing keeping the AI SDK
 * alive as a parallel executor, and it hid real problems: the user got an
 * answer from a different code path than the one they were exercising, and the
 * only trace was a log line nobody reads. A refusal is a bug report —
 * the projection domain is the target, and it should grow to cover whatever
 * shows up here, not be worked around at runtime.
 */
/**
 * Executor used when the Pi supply refuses the turn.
 *
 * The production value is `undefined`: a refusal is terminal and reported (see
 * above). Tests that drive the durable layer (retry, session log, persistence)
 * with a scripted model inject a harness here so they can keep asserting those
 * behaviours without a network endpoint — they are testing what happens AROUND
 * the model call, not which supply serves it. `piTurnHarness` is the builder
 * that seam now uses (the AI SDK builders are gone, ADR 009).
 */
export type TurnHarnessOverride = (plan: ExecutionPlan) => TurnDriverHarness | null;

/**
 * Build the Pi harness for a plan.
 *
 * The durable-layer test seam: pair it with `setTurnHarnessFallback` when a
 * suite scripts the model itself and must not reach the network. It is the
 * replacement for the removed `legacyTurnHarness`.
 */
export const piTurnHarness: TurnHarnessOverride = plan =>
  plan.enableTools
    ? new PiToolTurnHarness(planToHarnessConfig(plan))
    : new PiTextTurnHarness(planToHarnessConfig(plan));

/**
 * Process-wide FORCED executor.
 *
 * When set, it takes precedence over the supply decision entirely: the caller
 * has said which executor this process runs. That is what the durable-layer
 * suites need — their provider row points at a closed port and their model is a
 * scripted object, so letting Pi admit the turn would send it to a dead address
 * and time out. Production leaves this `null`, which makes a refusal
 * terminal and a healthy turn run on Pi.
 *
 * A module-level switch rather than a parameter because the selector is reached
 * from three deep call sites (streaming, send, and the turn driver's handoff
 * rebuild); threading a test-only argument through all of them would put test
 * knowledge in the production signature.
 */
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
  return new PiToolTurnHarness(planToHarnessConfig(plan), {
    // The plan is cleared at turn start (session_loop), so a long turn needs
    // a mid-flight nudge or write_todo_list is a one-shot at t=0.
    stepReminder: steps => todoReminderFor(steps, plan.enabledTools),
  });
};

/**
 * The turn cannot run: its history carries something the model supply layer
 * cannot project. Carries the concrete reason so the failed turn reports it
 * rather than a generic failure.
 */
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

/** The restart-recovery reconstruction (issue #133): the session-log replay
 * stamps the pending approval onto the assistant partial (tool-call +
 * tool-approval-request) so the AI SDK replay can pair the user's decision.
 * The Pi wire domain never carried that part — the live pause registers
 * `harness.getHistory()`, whose mirror has none — so a stripped replay
 * history IS the live paused mirror. The decided calls ride the owner's
 * resume commands, not the history; nothing else on the wire references the
 * stamps. Only `tool-approval-request` is stripped: any other out-of-domain
 * part (e.g. a tool-approval-response) still fails the projection. */
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

/** Whether the paused plan ran on the Pi tool supply — the approval-resume
 * path's selection test. The per-request domain gate does not re-run (the
 * paused history was admitted at pause time; the resumed segment appends
 * only tool results), but the recovered history is still projected so an
 * out-of-domain surprise fails the selection, not the provider call — after
 * `piDomainResumeHistory` normalizes it to the wire domain, so a
 * restart-recovered replay answers identically to the live mirror (issue
 * #133): the selection must not depend on which transport carries the
 * history. Mode does not gate either: an autonomous pause must resume on the
 * supply it paused on, or the supply flips mid-turn. */
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
