import { z } from 'zod';
import { tool } from 'ai';
import type { ToolNeedsApprovalFunction } from '@ai-sdk/provider-utils';
import type { AgentTool, AgentMessage } from '../agent/types';

/**
 * Enhanced Tool Result interface
 */
export interface ToolResult {
  toolName: string;
  toolCallId?: string;
  args: unknown;
  result: unknown;
  isError: boolean;
  error?: string;
}

type ApprovalPolicy = boolean | ToolNeedsApprovalFunction<unknown>;

/**
 * Base class for all tools with built-in validation
 */
export abstract class BaseTool<P extends z.ZodTypeAny = z.ZodTypeAny> {
  abstract name: string;
  abstract type: string;
  abstract needsApproval?: ApprovalPolicy;
  abstract description: string;
  abstract paramSchema: P;

  /**
   * Raw handler implementation
   */
  protected abstract handler(args: z.infer<P>): Promise<unknown>;

  /**
   * Get parameters in JSON Schema format (fallback if not provided)
   * Note: In a real app, you might want to use zod-to-json-schema
   */
  abstract get parameters(): Record<string, unknown>;

  /**
   * Execute the tool with validation
   */
  async execute(args: unknown): Promise<unknown> {
    const validatedArgs = this.paramSchema.parse(args);
    return await this.handler(validatedArgs);
  }

  /**
   * Convert to AI SDK Tool definition
   */
  toAiSdkTool() {
    return tool({
      description: this.description,
      inputSchema: this.paramSchema,
      needsApproval: this.needsApproval ?? false,
      execute: async (args: z.infer<P>) => await this.handler(args),
    } as unknown as Parameters<typeof tool>[0]);
  }

  /**
   * Convert to AgentTool interface
   */
  toAgentTool(): AgentTool {
    return {
      name: this.name,
      type: this.type,
      description: this.description,
      parameters: this.parameters,
      paramSchema: this.paramSchema,
      needsApproval: this.needsApproval ?? false,
      handler: (args: unknown) => this.execute(args),
    };
  }
}

/**
 * Tool Registry for maintaining a collection of tools
 */
export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool | BaseTool): void {
    const t = tool instanceof BaseTool ? tool.toAgentTool() : tool;
    this.tools.set(t.name, t);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  getAll(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  getToolDefinitions(): Record<string, { description: string; parameters: unknown }> {
    const definitions: Record<string, { description: string; parameters: unknown }> = {};
    for (const tool of this.tools.values()) {
      definitions[tool.name] = {
        description: tool.description,
        parameters: tool.parameters,
      };
    }
    return definitions;
  }

  getToolMetadata(): Array<{
    name: string;
    type: string;
    description: string;
    parameters: unknown;
  }> {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      type: t.type,
      description: t.description,
      parameters: t.parameters,
    }));
  }
}

/**
 * Global Tool Runner for executing tool calls
 */
export class ToolRunner {
  constructor(private registry: ToolRegistry) { }

  async run(toolName: string, args: unknown, toolCallId?: string): Promise<ToolResult> {
    const tool = this.registry.get(toolName);
    if (!tool) {
      return {
        toolName,
        toolCallId,
        args,
        result: null,
        isError: true,
        error: `Tool "${toolName}" not found`,
      };
    }

    try {
      // Use paramSchema if available for validation
      let finalArgs = args;
      if (tool.paramSchema) {
        finalArgs = tool.paramSchema.parse(args);
      }

      const result = await tool.handler(finalArgs);
      return {
        toolName,
        toolCallId,
        args: finalArgs,
        result,
        isError: false,
      };
    } catch (err: unknown) {
      console.error(`Error executing tool ${toolName}:`, err);
      return {
        toolName,
        toolCallId,
        args,
        result: null,
        isError: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async runMany(toolCalls: Array<{ name: string; arguments: unknown; id?: string }>): Promise<ToolResult[]> {
    return Promise.all(toolCalls.map(tc => this.run(tc.name, tc.arguments, tc.id)));
  }
}

/**
 * Helper to create an AgentTool with minimal boilerplate
 */
export function createTool<P extends z.ZodTypeAny>(options: {
  name: string;
  type: string;
  description: string;
  parameters: Record<string, unknown>;
  paramSchema?: P;
  needsApproval?: ApprovalPolicy;
  handler: (args: z.infer<P>) => Promise<unknown>;
}): AgentTool {
  return {
    ...options,
    needsApproval: options.needsApproval ?? false,
    paramSchema: options.paramSchema as unknown as AgentTool['paramSchema'],
  };
}

/**
 * Helper to format tool results into agent messages
 */
export function formatToolResultMessages(results: ToolResult[]): AgentMessage[] {
  return results.map(result => ({
    role: 'user' as const,
    content: JSON.stringify({
      tool: result.toolName,
      result: result.isError ? { error: result.error } : result.result,
    }),
    timestamp: new Date().toISOString(),
    metadata: {
      toolName: result.toolName,
      toolCallId: result.toolCallId,
      isError: result.isError,
    },
  }));
}

/**
 * Export a default registry for simple use cases
 */
export const defaultToolRegistry = new ToolRegistry();
export const defaultToolRunner = new ToolRunner(defaultToolRegistry);
