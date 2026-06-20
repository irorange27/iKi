import { z } from 'zod';
import type { AgentTool, ToolApprovalFunction, ToolApprovalMode } from '../agent/types';
import { createLogger } from '../logger';
import { zodSchemaToJsonSchema } from './json_schema';
import type { ToolRetryConfig } from './retry';

const toolLogger = createLogger({ module: 'base_tool' });

type ApprovalPolicy = boolean | ToolApprovalFunction;

/**
 * Base class for all tools with built-in validation
 */
export abstract class BaseTool<P extends z.ZodTypeAny = z.ZodTypeAny> {
  abstract name: string;
  abstract type: string;
  abstract needsApproval?: ApprovalPolicy;
  abstract description: string;
  abstract paramSchema: P;
  approvalMode?: ToolApprovalMode;
  displayName?: string;
  autoAllowed = true;
  outputSchema?: Record<string, unknown>;

  /** Retry configuration. If undefined, no retry is applied. */
  retry?: ToolRetryConfig;


  /**
   * Raw handler implementation
   */
  protected abstract handler(args: z.infer<P>): Promise<unknown>;

  /**
   * Get parameters in JSON Schema format (derived from Zod)
   */
  get parameters(): Record<string, unknown> {
    return zodSchemaToJsonSchema(this.paramSchema, { title: this.name });
  }

  /**
   * Execute the tool with validation and tracing.
   */
  async execute(args: unknown): Promise<unknown> {
    const validatedArgs = this.paramSchema.parse(args);
    const toolSpan = toolLogger.span({
      level: 'debug',
      event: 'tool.execute',
      data: { tool_name: this.name },
    });

    return this.handler(validatedArgs).then(
      result => {
        toolSpan.succeed({ data: { tool_name: this.name } });
        return result;
      },
      error => {
        toolSpan.fail(error, { data: { tool_name: this.name } });
        throw error;
      }
    );
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
      ...(this.approvalMode ? { approvalMode: this.approvalMode } : {}),
      autoAllowed: this.autoAllowed === true,
      displayName: this.displayName ?? this.name,
      source: { kind: 'builtin' },
      handler: (args: unknown) => this.execute(args),
      ...(this.retry ? { retry: this.retry } : {}),
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
      const parameters =
        tool.parameters ?? zodSchemaToJsonSchema(tool.paramSchema, { title: tool.name });
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
    approvalMode?: ToolApprovalMode;
    autoAllowed?: boolean;
  }> {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      type: t.type,
      description: t.description,
      parameters: t.parameters ?? zodSchemaToJsonSchema(t.paramSchema, { title: t.name }),
      outputSchema: t.outputSchema,
      displayName: t.displayName,
      source: t.source,
      autoAllowed: t.autoAllowed === true,
      ...(t.approvalMode ? { approvalMode: t.approvalMode } : {}),
      needsApproval:
        typeof t.needsApproval === 'boolean' ? t.needsApproval : t.needsApproval ? true : undefined,
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
  approvalMode?: ToolApprovalMode;
  autoAllowed?: boolean;
  displayName?: string;
  source?: AgentTool['source'];
  retry?: ToolRetryConfig;
  handler: (args: z.infer<P>) => Promise<unknown>;
}): AgentTool {
  const parameters =
    options.parameters ?? zodSchemaToJsonSchema(options.paramSchema, { title: options.name });
  const handler: AgentTool['handler'] = options.paramSchema
    ? (args: unknown) => options.handler(options.paramSchema!.parse(args))
    : (args: unknown) => options.handler(args as z.infer<P>);
  return {
    ...options,
    parameters,
    needsApproval: options.needsApproval ?? false,
    ...(options.approvalMode ? { approvalMode: options.approvalMode } : {}),
    autoAllowed: options.autoAllowed !== false,
    paramSchema: options.paramSchema,
    displayName: options.displayName ?? options.name,
    source: options.source ?? { kind: 'builtin' },
    handler,
    ...(options.retry ? { retry: options.retry } : {}),
  };
}

/**
 * Export a default registry for simple use cases
 */
export const defaultToolRegistry = new ToolRegistry();
