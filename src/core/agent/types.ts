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

// Agent Message Schema
export const AgentMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  timestamp: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

// Agent Tool Schema
// Note: handler function type and paramSchema are defined separately due to Zod limitations
export const AgentToolSchema = z.object({
  name: z.string().min(1),
  type: z.string().default('function'),
  description: z.string(),
  parameters: z.record(z.string(), z.any()), // JSON Schema format for LLM
  paramSchema: z.any().optional(), // Optional Zod schema (z.ZodTypeAny) for parameter validation
  needsApproval: z.any().optional().default(false),
  handler: z.any(), // Function type: (args: Record<string, any>) => Promise<any>
});

export type AgentTool = Omit<z.infer<typeof AgentToolSchema>, 'needsApproval'> & {
  needsApproval?: boolean | ToolNeedsApprovalFunction<unknown>;
  handler: (args: unknown) => Promise<unknown>;
  paramSchema?: z.ZodTypeAny;
};

// Agent State Schema
export const AgentStateSchema = z.object({
  messages: z.array(AgentMessageSchema),
  iteration: z.number().int().nonnegative(),
  history: z.array(z.string()),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

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

// Agent Result Schema
export const AgentResultSchema = z.object({
  response: z.string(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolApprovalRequests: z.array(ToolApprovalRequestSchema).optional(),
  iterations: z.number().int().nonnegative(),
  requiresApproval: z.boolean().optional(),
});

export type AgentResult = z.infer<typeof AgentResultSchema>;

// Agent Hook Context Schema
export const AgentHookContextSchema = z.object({
  agent: z.any(), // BaseAgent instance
  prompt: z.string(),
  iteration: z.number().int().nonnegative(),
  state: AgentStateSchema,
});

export type AgentHookContext = z.infer<typeof AgentHookContextSchema>;

// Agent Hook Type
export type AgentHook = (context: AgentHookContext) => Promise<void> | void;

// Partial Agent Config Schema (for updates)
export const PartialAgentConfigSchema = AgentConfigSchema.partial();

export type PartialAgentConfig = z.infer<typeof PartialAgentConfigSchema>;
