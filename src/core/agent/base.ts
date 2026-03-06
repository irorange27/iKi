import { tool, jsonSchema } from 'ai';

import { ConfigManager } from '../config';
import type { AppConfig } from '../../shared/types/config';
import { getConfig } from '../db/database';
import {
  AgentConfigSchema,
  AgentMessageSchema,
  AgentHookContextSchema,
  type AgentConfig,
  type AgentMessage,
  type AgentTool,
  type AgentState,
  type AgentResult,
  type AgentHook,
  type AgentHookContext,
  type PartialAgentConfig,
} from './types';

import { ToolRegistry } from '../tools/base';
import { logger } from '../logger';

/**
 * Abstract base class for all Agent implementations
 * Defines the common interface and shared functionality
 */
export abstract class BaseAgent {
  protected config: AgentConfig;
  protected toolRegistry: ToolRegistry = new ToolRegistry();
  protected state: AgentState;
  protected configManager: ConfigManager;
  protected hooks: Map<string, AgentHook[]> = new Map();

  constructor(config?: PartialAgentConfig) {
    this.configManager = new ConfigManager();
    this.config = this.loadConfig(config);
    this.state = {
      messages: [],
      iteration: 0,
      history: [],
    };
  }

  /**
   * Load agent configuration from app config or use provided config
   * Uses Zod for validation and type safety
   */
  protected loadConfig(overrideConfig?: PartialAgentConfig): AgentConfig {
    try {
      const appConfig = getConfig('app_config') as AppConfig | null;
      const agentConfig = appConfig?.agent || this.getDefaultConfig();

      // Merge configs
      const mergedConfig = {
        ...agentConfig,
        ...overrideConfig,
      };

      // Validate and parse with Zod (using defaults for missing fields)
      return AgentConfigSchema.parse(mergedConfig);
    } catch (error) {
      logger.error('Failed to load agent config:', error);
      try {
        // Try to parse with defaults
        const defaultConfig = this.getDefaultConfig();
        const mergedConfig = {
          ...defaultConfig,
          ...overrideConfig,
        };
        return AgentConfigSchema.parse(mergedConfig);
      } catch (parseError) {
        logger.error('Failed to parse agent config:', parseError);
        // Return default config as fallback
        return this.getDefaultConfig();
      }
    }
  }

  /**
   * Get default agent configuration
   * Can be overridden by subclasses to provide different defaults
   * Uses Zod schema defaults for type safety
   */
  protected getDefaultConfig(): AgentConfig {
    return AgentConfigSchema.parse({
      enabled: false,
      systemPrompt: 'You are a helpful AI assistant. You are capable, autonomous, and helpful.',
      providerType: '',
      model: '',
      temperature: 0.1,
      maxTokens: 2000,
      maxIterations: 10,
      enableTools: false,
      enableMemory: false,
    });
  }

  /**
   * Update agent configuration
   * Uses Zod for validation
   */
  async updateConfig(config: PartialAgentConfig): Promise<void> {
    try {
      // Merge and validate with Zod
      const mergedConfig = { ...this.config, ...config };
      this.config = AgentConfigSchema.parse(mergedConfig);

      // Persist to app config if needed
      try {
        const appConfig = (await this.configManager.read()) as AppConfig;
        if (appConfig) {
          appConfig.agent = this.config;
          await this.configManager.write(appConfig);
        }
      } catch (error) {
        logger.error('Failed to save agent config:', error);
      }
    } catch (error) {
      logger.error('Failed to update agent config (validation failed):', error);
      throw error;
    }
  }

  /**
   * Register a tool for the agent to use
   * Uses Zod for validation
   */
  registerTool(tool: AgentTool): void {
    try {
      this.toolRegistry.register(tool);
    } catch (error) {
      logger.error('Failed to register tool (validation failed):', error);
      throw error;
    }
  }

  /**
   * Register multiple tools
   */
  registerTools(tools: AgentTool[]): void {
    tools.forEach(tool => this.registerTool(tool));
  }

  /**
   * Get registered tools
   */
  getTools(): AgentTool[] {
    return this.toolRegistry.getAll();
  }

  /**
   * Register a hook for lifecycle events
   * @param event - Event name (e.g., 'beforeGenerate', 'afterGenerate', 'beforeIteration', 'afterIteration')
   * @param hook - Hook function
   */
  registerHook(event: string, hook: AgentHook): void {
    const hooks = this.hooks.get(event) || [];
    hooks.push(hook);
    this.hooks.set(event, hooks);
  }

  /**
   * Execute hooks for a given event
   * Uses Zod for context validation
   */
  protected async executeHooks(event: string, context: AgentHookContext): Promise<void> {
    try {
      // Validate context with Zod
      const validatedContext = AgentHookContextSchema.parse(context);
      const hooks = this.hooks.get(event) || [];
      for (const hook of hooks) {
        await hook(validatedContext);
      }
    } catch (error) {
      logger.error(`Failed to execute hooks for ${event} (validation failed):`, error);
      // Continue execution even if validation fails
    }
  }

  /**
   * Reset agent state
   */
  reset(): void {
    this.state = {
      messages: [],
      iteration: 0,
      history: [],
    };
  }

  /**
   * Set conversation messages
   * Uses Zod for validation
   */
  setMessages(messages: AgentMessage[]): void {
    try {
      // Validate all messages with Zod
      const validatedMessages = messages.map(msg => AgentMessageSchema.parse(msg));
      this.state.messages = validatedMessages;
    } catch (error) {
      logger.error('Failed to set messages (validation failed):', error);
      throw error;
    }
  }

  /**
   * Add a message to conversation
   * Uses Zod for validation
   */
  addMessage(message: AgentMessage): void {
    try {
      const messageWithTimestamp = {
        ...message,
        timestamp: message.timestamp || new Date().toISOString(),
      };
      // Validate message with Zod
      const validatedMessage = AgentMessageSchema.parse(messageWithTimestamp);
      this.state.messages.push(validatedMessage);
      logger.debug('Added message to agent state', {
        role: validatedMessage.role,
        contentLen: validatedMessage.content.length,
      });
    } catch (error) {
      logger.error('Failed to add message (validation failed):', error);
      throw error;
    }
  }

  /**
   * Execute a tool call
   * Uses Zod for parameter validation if paramSchema is provided
   * Can be overridden by subclasses for custom tool execution logic
   */
  protected async executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      throw new Error(`Tool "${toolName}" not found`);
    }

    try {
      // Validate arguments with Zod if paramSchema is provided
      let validatedArgs = args;
      if (tool.paramSchema) {
        try {
          validatedArgs = tool.paramSchema.parse(args);
        } catch (validationError) {
          throw new Error(
            `Invalid arguments for tool "${toolName}": ${validationError instanceof Error ? validationError.message : 'Validation failed'}`
          );
        }
      }

      const result = await tool.handler(validatedArgs);
      logger.debug(`Tool ${toolName} executed successfully`, { result });
      return result;
    } catch (error: unknown) {
      logger.error(`Error executing tool ${toolName}:`, error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Tool execution failed: ${message}`);
    }
  }

  /**
   * Build tools definition for LLM
   * Can be overridden by subclasses for custom tool building logic
   */
  protected buildTools(): Record<string, unknown> | undefined {
    if (!this.config.enableTools || this.toolRegistry.getAll().length === 0) {
      logger.debug('buildTools: tools disabled or no tools registered');
      return undefined;
    }

    const tools: Record<string, unknown> = {};
    const registeredTools = this.toolRegistry.getAll();
    logger.debug(`buildTools: building tools for ${registeredTools.length} registered tools`);

    for (const t of registeredTools) {
      // AI SDK v6 uses inputSchema instead of parameters
      // Prefer using paramSchema (Zod schema) directly - AI SDK v6 can handle Zod schemas natively
      if (t.paramSchema) {
        try {
          // Use inputSchema with Zod schema - this is the correct way for AI SDK v6
          const toolDef = tool({
            description: t.description,
            inputSchema: t.paramSchema,
            needsApproval: t.needsApproval,
            execute: t.handler,
          } as unknown as Parameters<typeof tool>[0]);

          const toolDefWithExecute = toolDef as unknown as { execute?: unknown };

          logger.debug(`Tool ${t.name} built successfully with Zod schema`, {
            toolName: t.name,
            hasExecute: typeof toolDefWithExecute.execute === 'function',
          });

          tools[t.name] = toolDef;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          const stack = error instanceof Error ? error.stack : undefined;
          logger.error(`Failed to build tool ${t.name} with Zod schema`, {
            error: message,
            stack,
          });
          throw error;
        }
      } else if (t.parameters) {
        // Fallback: use pre-defined JSON Schema
        // Note: AI SDK v6's inputSchema expects Zod schema, but we can try passing JSON Schema directly
        try {
          // For JSON Schema, we need to wrap it with jsonSchema() and use inputSchema
          const toolDef = tool({
            description: t.description,
            inputSchema: jsonSchema(t.parameters as object),
            needsApproval: t.needsApproval,
            execute: t.handler,
          } as unknown as Parameters<typeof tool>[0]);

          const toolDefWithExecute = toolDef as unknown as { execute?: unknown };

          logger.debug(`Tool ${t.name} built successfully with JSON Schema`, {
            toolName: t.name,
            hasExecute: typeof toolDefWithExecute.execute === 'function',
          });

          tools[t.name] = toolDef;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          const stack = error instanceof Error ? error.stack : undefined;
          logger.error(`Failed to build tool ${t.name} with JSON Schema`, {
            error: message,
            stack,
            parameters: JSON.stringify(t.parameters, null, 2),
          });
          throw error;
        }
      } else {
        logger.warn(`Tool ${t.name} has neither parameters nor paramSchema`);
      }
    }

    logger.debug(`buildTools: built ${Object.keys(tools).length} tools`, {
      toolNames: Object.keys(tools),
    });

    return Object.keys(tools).length > 0 ? tools : undefined;
  }

  /**
   * Build messages for LLM
   * Can be overridden by subclasses for custom message building logic
   */
  protected buildMessages(): Array<Record<string, unknown>> {
    const messages: Array<Record<string, unknown>> = [];

    // Add system prompt if configured
    if (this.config.systemPrompt) {
      messages.push({
        role: 'system',
        content: this.config.systemPrompt,
      });
    }

    // Add conversation messages
    for (const msg of this.state.messages) {
      if (msg.role === 'tool') {
        try {
          // content should be JSON string of result
          const content = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
          messages.push({
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: msg.metadata?.toolCallId || 'unknown',
                toolName: msg.metadata?.toolName || content.tool,
                output: content.output ?? content.result ?? content,
              },
            ],
          });
        } catch (e) {
          logger.warn('Failed to parse tool message content', { error: e });
        }
      } else if (msg.role === 'assistant') {
        const toolCalls = msg.metadata?.toolCalls;
        if (toolCalls && Array.isArray(toolCalls)) {
          messages.push({
            role: 'assistant',
            content: [{ type: 'text', text: msg.content }, ...toolCalls],
          });
        } else {
          messages.push({ role: 'assistant', content: msg.content });
        }
      } else if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'system') {
        messages.push({ role: 'system', content: msg.content });
      }
    }

    return messages;
  }

  /**
   * Validate agent configuration
   * Uses Zod for validation
   * Can be overridden by subclasses for custom validation
   */
  protected validateConfig(): void {
    // Validate config structure with Zod
    try {
      AgentConfigSchema.parse(this.config);
    } catch (error) {
      throw new Error(
        `Invalid agent configuration: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // Business logic validation
    if (!this.config.enabled) {
      throw new Error('Agent is not enabled');
    }

    if (!this.config.providerType || !this.config.model) {
      throw new Error('Agent provider and model must be configured');
    }
  }

  /**
   * Abstract method: Generate response (non-streaming)
   * Must be implemented by subclasses
   */
  abstract generate(prompt: string): Promise<AgentResult>;

  /**
   * Abstract method: Stream response
   * Must be implemented by subclasses
   */
  abstract stream(prompt: string): AsyncGenerator<string, AgentResult, unknown>;

  /**
   * Get current agent state
   */
  getState(): AgentState {
    return { ...this.state };
  }

  /**
   * Get agent configuration
   */
  getConfig(): AgentConfig {
    return { ...this.config };
  }
}
