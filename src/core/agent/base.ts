import { getAppConfig, setAppConfig } from '../config';
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
import {
  buildAiToolSet,
  getDefaultAgentConfig,
  loadAgentConfig,
  validateAgentConfig,
} from './ai_sdk_runtime';

import { ToolRegistry } from '../tools/base';
import { logger } from '../logger';

/**
 * Abstract base class for conversation-oriented agent implementations.
 * Defines shared config, tool, hook, and message-state behavior.
 */
export abstract class BaseAgent {
  protected config: AgentConfig;
  protected toolRegistry: ToolRegistry = new ToolRegistry();
  protected state: AgentState;
  protected hooks: Map<string, AgentHook[]> = new Map();

  constructor(config?: PartialAgentConfig) {
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
    return loadAgentConfig(overrideConfig);
  }

  /**
   * Get default agent configuration
   * Can be overridden by subclasses to provide different defaults
   * Uses Zod schema defaults for type safety
   */
  protected getDefaultConfig(): AgentConfig {
    return getDefaultAgentConfig();
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
        const appConfig = getAppConfig();
        appConfig.agent = this.config;
        setAppConfig(appConfig);
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
    return buildAiToolSet(this.config, this.toolRegistry.getAll());
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
        const toolCalls = Array.isArray(msg.metadata?.toolCalls) ? msg.metadata.toolCalls : [];
        const toolApprovalRequests = Array.isArray(msg.metadata?.toolApprovalRequests)
          ? msg.metadata.toolApprovalRequests
          : [];

        if (toolCalls.length > 0 || toolApprovalRequests.length > 0) {
          const contentParts: Array<Record<string, unknown>> = [];
          if (msg.content.trim()) {
            contentParts.push({ type: 'text', text: msg.content });
          }

          messages.push({
            role: 'assistant',
            content: [...contentParts, ...toolCalls, ...toolApprovalRequests],
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
    validateAgentConfig(this.config);
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
