import type { HarnessConfig } from './harness_types';
import { PiToolTurnHarness } from '../runners/pi_tool_turn_harness';
import { PiTextTurnHarness } from '../runners/pi_text_turn_harness';

export type TurnHarnessAssembly = Omit<HarnessConfig, 'maxOutputTokens'> & {

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

export const startPiTurnHarness = (assembly: TurnHarnessAssembly) => {
  const config = toHarnessConfig(assembly);
  return config.enableTools
    ? new PiToolTurnHarness(config)
    : new PiTextTurnHarness(config);
};
