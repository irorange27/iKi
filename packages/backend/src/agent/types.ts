import { z } from 'zod';

export type ToolApprovalFunction = (input: unknown, options: { toolCallId: string; messages: unknown[]; experimental_context?: unknown }) => boolean | Promise<boolean>;

export interface ToolRetryConfig {

  maxRetries: number;

  backoffMs?: number;

  retryableError?: (error: unknown) => boolean;

  fallback?: (lastError: unknown) => unknown | Promise<unknown>;
}

export const AgentConfigSchema = z.object({
  enabled: z.boolean(),
  systemPrompt: z.string(),
  providerType: z.string(),
  providerId: z.string().default(''),
  model: z.string(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().positive().default(2000),

  maxIterations: z.number().int().positive().default(200),
  enableTools: z.boolean().default(false),
  enableMemory: z.boolean().default(false),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ToolApprovalModeSchema = z.enum(['configurable', 'always']);
export type ToolApprovalMode = z.infer<typeof ToolApprovalModeSchema>;

export const AgentToolSchema = z.object({
  name: z.string().min(1),
  type: z.string().default('function'),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  paramSchema: z.unknown().optional(),
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
  handler: z.unknown(),
});

export type AgentTool = Omit<z.infer<typeof AgentToolSchema>, 'needsApproval'> & {
  needsApproval?: boolean | ToolApprovalFunction;
  approvalMode?: ToolApprovalMode;

  declaredNeedsApproval?: boolean;

  replay?: 'safe' | 'unsafe';
  handler: (args: unknown) => Promise<unknown>;
  paramSchema?: z.ZodTypeAny;

  retry?: ToolRetryConfig;
};

export const ToolCallSchema = z.object({
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.unknown().optional(),
});

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

export const AgentResultSchema = z.object({
  response: z.string(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolApprovalRequests: z.array(ToolApprovalRequestSchema).optional(),
  usage: AgentUsageSchema.optional(),

  lastStepInputTokens: z.number().optional(),
  perf: AgentTurnPerfSchema.optional(),

  toolSchemaTokens: z.object({ builtin: z.number(), mcp: z.number() }).optional(),
  iterations: z.number().int().nonnegative(),
  requiresApproval: z.boolean().optional(),
  finishReason: z.string().optional(),
  contextWarning: z.boolean().optional(),
});

export type AgentResult = z.infer<typeof AgentResultSchema>;

export const PartialAgentConfigSchema = AgentConfigSchema.partial();

export type PartialAgentConfig = z.infer<typeof PartialAgentConfigSchema>;
