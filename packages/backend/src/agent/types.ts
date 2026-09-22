import { z } from 'zod';

export type ToolApprovalFunction = (input: unknown, options: { toolCallId: string; messages: unknown[]; experimental_context?: unknown }) => boolean | Promise<boolean>;

export interface ToolRetryConfig {
  /** Maximum number of retry attempts (total attempts = 1 + maxRetries). */
  maxRetries: number;
  /** Base backoff in milliseconds. Doubles each attempt, capped at 2000ms. Default 250. */
  backoffMs?: number;
  /** Custom predicate to decide if an error should be retried. Falls back to isRetryableError. */
  retryableError?: (error: unknown) => boolean;
  /**
   * If provided, called when all retries are exhausted.
   * The return value replaces the error, allowing graceful degradation
   * (e.g., returning partial output on timeout).
   */
  fallback?: (lastError: unknown) => unknown | Promise<unknown>;
}

/**
 * Agent framework type definitions using Zod schemas
 * Types are inferred from schemas for type safety and runtime validation
 */

// Agent Configuration Schema
export const AgentConfigSchema = z.object({
  enabled: z.boolean(),
  systemPrompt: z.string(),
  providerType: z.string(),
  providerId: z.string().default(''),
  model: z.string(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().positive().default(2000),
  // Model steps per turn; mirrors the chat-turn default
  // (DEFAULT_TOOL_CALL_MAX_ITERATIONS in thread_session/constants).
  maxIterations: z.number().int().positive().default(200),
  enableTools: z.boolean().default(false),
  enableMemory: z.boolean().default(false),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ToolApprovalModeSchema = z.enum(['configurable', 'always']);
export type ToolApprovalMode = z.infer<typeof ToolApprovalModeSchema>;

// Agent Tool Schema
// Note: handler function type and paramSchema are defined separately due to Zod limitations
export const AgentToolSchema = z.object({
  name: z.string().min(1),
  type: z.string().default('function'),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()), // JSON Schema format for LLM
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  paramSchema: z.unknown().optional(), // Optional Zod schema (z.ZodTypeAny) for parameter validation
  needsApproval: z.unknown().optional().default(false),
  approvalMode: ToolApprovalModeSchema.optional(),
  autoAllowed: z.boolean().optional(),
  displayName: z.string().optional(),
  source: z
    .object({
      kind: z.enum(['builtin', 'mcp']),
      id: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  handler: z.unknown(), // Function type: (args: Record<string, unknown>) => Promise<unknown>
});

export type AgentTool = Omit<z.infer<typeof AgentToolSchema>, 'needsApproval'> & {
  needsApproval?: boolean | ToolApprovalFunction;
  approvalMode?: ToolApprovalMode;
  handler: (args: unknown) => Promise<unknown>;
  paramSchema?: z.ZodTypeAny;
  /** Retry configuration. Applied in buildAiToolSet for non-BaseTool tools. */
  retry?: ToolRetryConfig;
};

// Tool Call Result Schema
export const ToolCallSchema = z.object({
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.unknown().optional(),
});

// Tool Approval Request Schema
export const ToolApprovalRequestSchema = z.object({
  approvalId: z.string(),
  toolCallId: z.string().optional(),
  toolCall: z
    .object({
      toolName: z.string(),
      args: z.record(z.string(), z.unknown()),
    })
    .optional(),
});

export type ToolApprovalRequest = z.infer<typeof ToolApprovalRequestSchema>;

export const AgentUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  reasoningTokens: z.number().int().nonnegative().default(0),
  estimatedCostUsd: z.number().nonnegative().default(0),
});

export type AgentUsage = z.infer<typeof AgentUsageSchema>;

/**
 * Wall-clock perf metrics for one harness turn, measured in the agent runner
 * around the model stream. `llmMs` excludes tool execution; `firstTokenMs` is
 * the sum of per-step first-token latencies (`firstTokenSamples` = rounds the
 * latency was observed for, i.e. the divisor for the average).
 */
export const AgentTurnPerfSchema = z.object({
  llmMs: z.number().nonnegative().default(0),
  toolMs: z.number().nonnegative().default(0),
  firstTokenMs: z.number().nonnegative().default(0),
  firstTokenSamples: z.number().int().nonnegative().default(0),
  toolCalls: z.number().int().nonnegative().default(0),
  steps: z.number().int().nonnegative().default(0),
});

export type AgentTurnPerf = z.infer<typeof AgentTurnPerfSchema>;

export const addTurnPerf = (
  a: AgentTurnPerf | undefined,
  b: AgentTurnPerf | undefined
): AgentTurnPerf | undefined => {
  if (!a) return b;
  if (!b) return a;
  return {
    llmMs: a.llmMs + b.llmMs,
    toolMs: a.toolMs + b.toolMs,
    firstTokenMs: a.firstTokenMs + b.firstTokenMs,
    firstTokenSamples: a.firstTokenSamples + b.firstTokenSamples,
    toolCalls: a.toolCalls + b.toolCalls,
    steps: a.steps + b.steps,
  };
};

// Agent Result Schema
export const AgentResultSchema = z.object({
  response: z.string(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolApprovalRequests: z.array(ToolApprovalRequestSchema).optional(),
  usage: AgentUsageSchema.optional(),
  perf: AgentTurnPerfSchema.optional(),
  iterations: z.number().int().nonnegative(),
  requiresApproval: z.boolean().optional(),
  finishReason: z.string().optional(),
  contextWarning: z.boolean().optional(),
});

export type AgentResult = z.infer<typeof AgentResultSchema>;

// Partial Agent Config Schema (for updates)
export const PartialAgentConfigSchema = AgentConfigSchema.partial();

export type PartialAgentConfig = z.infer<typeof PartialAgentConfigSchema>;

export type ChatStreamEvent = {
  type: string;
  [key: string]: unknown;
};
