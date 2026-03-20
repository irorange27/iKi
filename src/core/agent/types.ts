import { z } from 'zod';
import type { ToolNeedsApprovalFunction } from '@ai-sdk/provider-utils';

/**
 * Agent framework type definitions using Zod schemas
 * Types are inferred from schemas for type safety and runtime validation
 */

// Agent Configuration Schema
export const AgentConfigSchema = z.object({
  enabled: z.boolean(),
  systemPrompt: z.string(),
  providerType: z.string(),
  model: z.string(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().positive().default(2000),
  maxIterations: z.number().int().positive().default(10),
  enableTools: z.boolean().default(false),
  enableMemory: z.boolean().default(false),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// Agent Tool Schema
// Note: handler function type and paramSchema are defined separately due to Zod limitations
export const AgentToolSchema = z.object({
  name: z.string().min(1),
  type: z.string().default('function'),
  description: z.string(),
  parameters: z.record(z.string(), z.any()), // JSON Schema format for LLM
  outputSchema: z.record(z.string(), z.any()).optional(),
  paramSchema: z.any().optional(), // Optional Zod schema (z.ZodTypeAny) for parameter validation
  needsApproval: z.any().optional().default(false),
  autoAllowed: z.boolean().optional(),
  displayName: z.string().optional(),
  source: z
    .object({
      kind: z.enum(['builtin', 'mcp']),
      id: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  handler: z.any(), // Function type: (args: Record<string, any>) => Promise<any>
});

export type AgentTool = Omit<z.infer<typeof AgentToolSchema>, 'needsApproval'> & {
  needsApproval?: boolean | ToolNeedsApprovalFunction<unknown>;
  handler: (args: unknown) => Promise<unknown>;
  paramSchema?: z.ZodTypeAny;
};

// Tool Call Result Schema
export const ToolCallSchema = z.object({
  toolName: z.string(),
  args: z.record(z.string(), z.any()),
  result: z.any().optional(),
});

// Tool Approval Request Schema
export const ToolApprovalRequestSchema = z.object({
  approvalId: z.string(),
  toolCallId: z.string().optional(),
  toolCall: z
    .object({
      toolName: z.string(),
      args: z.record(z.string(), z.any()),
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

// Agent Result Schema
export const AgentResultSchema = z.object({
  response: z.string(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolApprovalRequests: z.array(ToolApprovalRequestSchema).optional(),
  usage: AgentUsageSchema.optional(),
  iterations: z.number().int().nonnegative(),
  requiresApproval: z.boolean().optional(),
});

export type AgentResult = z.infer<typeof AgentResultSchema>;

// Partial Agent Config Schema (for updates)
export const PartialAgentConfigSchema = AgentConfigSchema.partial();

export type PartialAgentConfig = z.infer<typeof PartialAgentConfigSchema>;
