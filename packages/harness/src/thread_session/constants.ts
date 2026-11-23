import { buildToolSystemPrompt } from '@iki/system-prompt/tool_rules';

const DEFAULT_TOOL_CALL_MAX_ITERATIONS = 200;

export const resolveToolCallMaxIterations = (value?: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : DEFAULT_TOOL_CALL_MAX_ITERATIONS;

export { buildToolSystemPrompt };
