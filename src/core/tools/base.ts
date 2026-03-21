import { z } from 'zod';
import { jsonSchema, tool } from 'ai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolNeedsApprovalFunction } from '@ai-sdk/provider-utils';
import type { AgentTool } from '../agent/types';

type ApprovalPolicy = boolean | ToolNeedsApprovalFunction<unknown>;

const deriveJsonSchema = (
  schema: z.ZodTypeAny | undefined,
  fallbackTitle?: string
): Record<string, unknown> => {
  if (!schema) {
    return {
      type: 'object',
      title: fallbackTitle,
      properties: {},
    };
  }

  try {
    const jsonSchema = zodToJsonSchema(schema as unknown as Parameters<typeof zodToJsonSchema>[0], {
      $refStrategy: 'none',
      name: fallbackTitle,
    });
    if (jsonSchema && typeof jsonSchema === 'object') {
      return jsonSchema as Record<string, unknown>;
    }
  } catch (error) {
    console.warn('[ToolSchema] Failed to derive JSON schema from Zod', error);
  }

  return {
    type: 'object',
    title: fallbackTitle,
    properties: {},
  };
};

/**
 * Base class for all tools with built-in validation
 */
export abstract class BaseTool<P extends z.ZodTypeAny = z.ZodTypeAny> {
  abstract name: string;
  abstract type: string;
  abstract needsApproval?: ApprovalPolicy;
  abstract description: string;
  abstract paramSchema: P;
  displayName?: string;
  autoAllowed = false;
  outputSchema?: Record<string, unknown>;

  /**
   * Raw handler implementation
   */
  protected abstract handler(args: z.infer<P>): Promise<unknown>;

  /**
   * Get parameters in JSON Schema format (derived from Zod)
   */
  get parameters(): Record<string, unknown> {
    return deriveJsonSchema(this.paramSchema, this.name);
  }

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
      ...(this.outputSchema ? { outputSchema: jsonSchema(this.outputSchema as object) } : {}),
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
      outputSchema: this.outputSchema,
      paramSchema: this.paramSchema,
      needsApproval: this.needsApproval ?? false,
      autoAllowed: this.autoAllowed === true,
      displayName: this.displayName ?? this.name,
      source: { kind: 'builtin' },
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
    const source =
      t.source && typeof t.source === 'object' ? t.source : { kind: 'builtin' as const };
    const displayName = typeof t.displayName === 'string' ? t.displayName : t.name;
    this.tools.set(t.name, { ...t, autoAllowed: t.autoAllowed === true, source, displayName });
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  getAll(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  remove(name: string): void {
    this.tools.delete(name);
  }

  removeBySource(predicate: (source?: AgentTool['source']) => boolean): void {
    for (const [name, tool] of this.tools.entries()) {
      if (predicate(tool.source)) {
        this.tools.delete(name);
      }
    }
  }

  getToolDefinitions(): Record<
    string,
    { description: string; parameters: unknown; outputSchema?: unknown }
  > {
    const definitions: Record<
      string,
      { description: string; parameters: unknown; outputSchema?: unknown }
    > = {};
    for (const tool of this.tools.values()) {
      const parameters = tool.parameters ?? deriveJsonSchema(tool.paramSchema, tool.name);
      definitions[tool.name] = {
        description: tool.description,
        parameters,
        outputSchema: tool.outputSchema,
      };
    }
    return definitions;
  }

  getToolMetadata(): Array<{
    name: string;
    type: string;
    description: string;
    parameters: unknown;
    outputSchema?: unknown;
    displayName?: string;
    source?: AgentTool['source'];
    needsApproval?: boolean;
    autoAllowed?: boolean;
  }> {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      type: t.type,
      description: t.description,
      parameters: t.parameters ?? deriveJsonSchema(t.paramSchema, t.name),
      outputSchema: t.outputSchema,
      displayName: t.displayName,
      source: t.source,
      autoAllowed: t.autoAllowed === true,
      needsApproval: typeof t.needsApproval === 'boolean' ? t.needsApproval : undefined,
    }));
  }
}

/**
 * Helper to create an AgentTool with minimal boilerplate
 */
export function createTool<P extends z.ZodTypeAny>(options: {
  name: string;
  type: string;
  description: string;
  parameters?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  paramSchema?: P;
  needsApproval?: ApprovalPolicy;
  autoAllowed?: boolean;
  displayName?: string;
  source?: AgentTool['source'];
  handler: (args: z.infer<P>) => Promise<unknown>;
}): AgentTool {
  const parameters = options.parameters ?? deriveJsonSchema(options.paramSchema, options.name);
  return {
    ...options,
    parameters,
    needsApproval: options.needsApproval ?? false,
    autoAllowed: options.autoAllowed === true,
    paramSchema: options.paramSchema as unknown as AgentTool['paramSchema'],
    displayName: options.displayName ?? options.name,
    source: options.source ?? { kind: 'builtin' },
  };
}

/**
 * Export a default registry for simple use cases
 */
export const defaultToolRegistry = new ToolRegistry();
