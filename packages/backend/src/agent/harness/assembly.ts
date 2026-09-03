import { AgentHarness } from './agent_harness';
import type { HarnessConfig } from './harness_types';

/**
 * The single assembly point for harness construction (conventions landmine #6):
 * every `new AgentHarness` goes through startTurnHarness or rehydrateHarness so
 * new always-pass config fields and default policy land here, not at five sites.
 */
export type TurnHarnessAssembly = Omit<HarnessConfig, 'maxOutputTokens'> & {
  /** Non-finite/null values omit the output cap instead of passing it through. */
  maxOutputTokens?: HarnessConfig['maxOutputTokens'] | null;
};

const toHarnessConfig = (assembly: TurnHarnessAssembly): HarnessConfig => ({
  ...assembly,
  ...(typeof assembly.maxOutputTokens === 'number'
    ? { maxOutputTokens: assembly.maxOutputTokens }
    : {}),
});

/** A harness for a brand-new turn (stream send, chat send, delegated subagent). */
export const startTurnHarness = (assembly: TurnHarnessAssembly): AgentHarness =>
  new AgentHarness(toHarnessConfig(assembly));

/** A harness rebuilt from durable state (approval resume, handoff-resume). */
export const rehydrateHarness = (assembly: TurnHarnessAssembly): AgentHarness =>
  new AgentHarness(toHarnessConfig(assembly));
