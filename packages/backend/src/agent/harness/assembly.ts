import type { HarnessConfig } from './harness_types';
import { PiToolTurnHarness } from '../runners/pi_tool_turn_harness';
import { PiTextTurnHarness } from '../runners/pi_text_turn_harness';

/**
 * The single assembly point for harness construction (conventions landmine #6):
 * every harness is built here so new always-pass config fields and default
 * policy land in one place, not at five call sites.
 *
 * The AI SDK executors (`startTurnHarness`, `rehydrateHarness`) were removed
 * with the supply retirement (ADR 009); `startPiTurnHarness` is the only
 * builder left.
 */
export type TurnHarnessAssembly = Omit<HarnessConfig, 'maxOutputTokens'> & {
  /** Non-finite/null values omit the output cap instead of passing it through. */
  maxOutputTokens?: HarnessConfig['maxOutputTokens'] | null;
};

const toHarnessConfig = (assembly: TurnHarnessAssembly): HarnessConfig => {
  const { maxInputTokens, maxOutputTokens, ...config } = assembly;
  const validBudget = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;
  return {
    ...config,
    ...(validBudget(maxInputTokens) ? { maxInputTokens } : {}),
    ...(validBudget(maxOutputTokens) ? { maxOutputTokens } : {}),
  };
};

/**
 * The Pi-supply harness for a turn, sharing the same assembly contract.
 *
 * Exists so a composition root can choose the supply without knowing which
 * class implements it — the delegated subagent is the caller that needs this
 * (it builds a child harness per delegation). Tool-enabled assemblies get the
 * tool harness, which now honours `toolsOverride` (the capability bound the
 * subagent inherits); a tool-free assembly gets the text harness.
 */
export const startPiTurnHarness = (assembly: TurnHarnessAssembly) => {
  const config = toHarnessConfig(assembly);
  return config.enableTools
    ? new PiToolTurnHarness(config)
    : new PiTextTurnHarness(config);
};
