import {
  generateText,
  stepCountIs,
  streamText,
  type ModelMessage,
  type ToolApprovalResponse,
  type ToolSet,
} from 'ai';

import { createModel, getFullSystemPrompt } from './provider/llm/factory';
import { BaseAgent } from './agent/base';
import type { AgentResult, ToolApprovalRequest as AgentToolApprovalRequest } from './agent/types';
import { logger } from './logger';

/**
 * LLM-based Simple Agent implementation
 * Uses language models for text generation with optional tool calling support
 */
export class SimpleAgent extends BaseAgent {
  /**
   * Generate response using LLM (non-streaming)
   * Uses AI SDK's maxSteps for automatic tool execution
   */
  private pendingApprovalRequests: AgentToolApprovalRequest[] = [];

  private static isToolCall(
    value: unknown
  ): value is { toolName: string; input?: unknown; args?: unknown } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'toolName' in value &&
      typeof (value as { toolName: unknown }).toolName === 'string' &&
      ('input' in value || 'args' in value)
    );
  }

  private static isApprovalRequestPart(value: unknown): value is {
    type: 'tool-approval-request';
    approvalId: string;
    toolCall: { toolName: string; toolCallId?: string; input?: unknown };
  } {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as { type?: unknown }).type === 'tool-approval-request' &&
      typeof (value as { approvalId?: unknown }).approvalId === 'string' &&
      typeof (value as { toolCall?: { toolName?: unknown } }).toolCall?.toolName === 'string'
    );
  }

  private static normalizeToolArgs(input: unknown): Record<string, unknown> {
    if (input === undefined) return {};
    if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
      return input as Record<string, unknown>;
    }
    return { value: input };
  }

  private static mapApprovalRequest(part: {
    approvalId: string;
    toolCall: { toolName: string; toolCallId?: string; input?: unknown };
  }): AgentToolApprovalRequest {
    return {
      approvalId: part.approvalId,
      toolCallId: part.toolCall.toolCallId,
      toolCall: {
        toolName: part.toolCall.toolName,
        args: SimpleAgent.normalizeToolArgs(part.toolCall.input),
      },
    };
  }

  private buildPromptContext(): { systemPrompt: string; messages: ModelMessage[] } {
    const builtMessages = this.buildMessages() as ModelMessage[];
    const systemParts: string[] = [getFullSystemPrompt(this.config.providerType)];

    for (const message of builtMessages) {
      if (
        message &&
        typeof message === 'object' &&
        message.role === 'system' &&
        typeof message.content === 'string' &&
        message.content.trim()
      ) {
        systemParts.push(message.content.trim());
      }
    }

    return {
      systemPrompt: systemParts.join('\n\n'),
      messages: builtMessages.filter(message => message?.role !== 'system'),
    };
  }

  private static extractAssistantText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';

    return content
      .filter(
        part =>
          part &&
          typeof part === 'object' &&
          (part as { type?: string }).type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string'
      )
      .map(part => (part as { text: string }).text)
      .join('');
  }

  private syncMessagesFromResponse(responseMessages: unknown): void {
    if (!Array.isArray(responseMessages) || responseMessages.length === 0) return;

    // AI SDK response.messages are incremental messages to append.
    for (const rawMessage of responseMessages) {
      if (!rawMessage || typeof rawMessage !== 'object') continue;

      const message = rawMessage as { role?: string; content?: unknown };
      if (message.role === 'assistant') {
        const content = SimpleAgent.extractAssistantText(message.content);
        const toolCalls = Array.isArray(message.content)
          ? message.content.filter(
              part =>
                part &&
                typeof part === 'object' &&
                (part as { type?: string }).type === 'tool-call'
            )
          : [];
        const toolApprovalRequests = Array.isArray(message.content)
          ? message.content.filter(
              part =>
                part &&
                typeof part === 'object' &&
                (part as { type?: string }).type === 'tool-approval-request'
            )
          : [];

        if (!content && toolCalls.length === 0 && toolApprovalRequests.length === 0) continue;

        this.addMessage({
          role: 'assistant',
          content,
          metadata:
            toolCalls.length > 0 || toolApprovalRequests.length > 0
              ? {
                  ...(toolCalls.length > 0 ? { toolCalls } : {}),
                  ...(toolApprovalRequests.length > 0
                    ? { toolApprovalRequests }
                    : {}),
                }
              : undefined,
        });
      } else if (message.role === 'tool') {
        if (!Array.isArray(message.content)) {
          this.addMessage({
            role: 'tool',
            content:
              typeof message.content === 'string'
                ? message.content
                : JSON.stringify(message.content ?? {}),
          });
          continue;
        }

        for (const part of message.content) {
          if (!part || typeof part !== 'object') continue;
          const typedPart = part as {
            type?: string;
            toolCallId?: string;
            toolName?: string;
            output?: unknown;
            approvalId?: string;
            approved?: boolean;
            reason?: string;
          };

          if (typedPart.type === 'tool-result') {
            this.addMessage({
              role: 'tool',
              content: JSON.stringify(typedPart.output ?? {}),
              metadata: {
                toolCallId: typedPart.toolCallId,
                toolName: typedPart.toolName,
              },
            });
          } else if (typedPart.type === 'tool-approval-response') {
            this.addMessage({
              role: 'tool',
              content: JSON.stringify({
                approvalId: typedPart.approvalId,
                approved: typedPart.approved,
                reason: typedPart.reason,
              }),
              metadata: {
                approvalId: typedPart.approvalId,
              },
            });
          }
        }
      }
    }
  }

  async generate(prompt: string): Promise<AgentResult> {
    this.validateConfig();

    // Execute beforeGenerate hooks
    logger.debug('Executing beforeGenerate hooks');
    await this.executeHooks('beforeGenerate', {
      agent: this,
      prompt,
      iteration: this.state.iteration,
      state: this.getState(),
    });

    // Add user message
    this.addMessage({ role: 'user', content: prompt });

    const model = createModel(this.config.providerType, this.config.model);
    const tools = this.buildTools() as ToolSet | undefined;
    const { systemPrompt, messages } = this.buildPromptContext();

    logger.debug('Sending LLM Request', {
      model: this.config.model,
      toolCount: tools ? Object.keys(tools).length : 0,
      tools: tools ? tools : undefined,
      messages: JSON.stringify(messages, null, 2),
    });

    try {
      const result = await generateText({
        model,
        system: systemPrompt,
        messages,
        tools,
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxTokens,
        stopWhen: stepCountIs(this.config.enableTools ? this.config.maxIterations : 1),
        onStepFinish: async ({
          toolCalls,
          toolResults,
        }: {
          toolCalls?: unknown[];
          toolResults?: unknown[];
        }) => {
          logger.debug('Step finished', {
            toolCallsLen: toolCalls?.length,
            resultLen: toolResults?.length,
          });
        },
      });

      // Check for tool approval requests in the result content
      const toolApprovalRequests: AgentToolApprovalRequest[] = [];
      for (const part of result.content) {
        if (SimpleAgent.isApprovalRequestPart(part)) {
          toolApprovalRequests.push(SimpleAgent.mapApprovalRequest(part));
        }
      }

      this.syncMessagesFromResponse(result.response.messages);

      // If there are tool approval requests, return them for user approval
      if (toolApprovalRequests.length > 0) {
        return {
          response: result.text,
          toolCalls: result.toolCalls?.filter(SimpleAgent.isToolCall).map(tc => ({
            toolName: tc.toolName,
            args: SimpleAgent.normalizeToolArgs(tc.input),
          })),
          toolApprovalRequests,
          iterations: result.steps ? result.steps.length : 1,
        };
      }

      // Collect all tool calls from steps
      const allToolCalls: Array<{ toolName: string; input?: unknown; args?: unknown }> = [];
      if (result.steps) {
        for (const step of result.steps) {
          if (step.toolCalls) {
            allToolCalls.push(...step.toolCalls.filter(SimpleAgent.isToolCall));
          }
        }
      }

      const agentResult: AgentResult = {
        response: result.text,
        toolCalls:
          allToolCalls.length > 0
            ? allToolCalls.map(tc => ({
                toolName: tc.toolName,
                args: SimpleAgent.normalizeToolArgs(tc.input),
              }))
            : undefined,
        iterations: result.steps ? result.steps.length : 1,
      };

      // Execute afterGenerate hooks
      await this.executeHooks('afterGenerate', {
        agent: this,
        prompt,
        iteration: agentResult.iterations,
        state: this.getState(),
      });

      return agentResult;
    } catch (error) {
      logger.error('LLM Generation Failed (SimpleAgent):', error);
      throw error;
    }
  }

  /**
   * Stream response using LLM
   * Uses AI SDK's maxSteps for automatic tool execution
   */
  async *stream(
    prompt: string,
    approvalResponses?: ToolApprovalResponse[],
    onStreamPart?: (part: { type: string; [key: string]: unknown }) => void,
    abortSignal?: AbortSignal
  ): AsyncGenerator<string, AgentResult, unknown> {
    this.validateConfig();

    if (!approvalResponses) {
      this.pendingApprovalRequests = [];
    }
    // Execute beforeGenerate hooks
    await this.executeHooks('beforeGenerate', {
      agent: this,
      prompt,
      iteration: this.state.iteration,
      state: this.getState(),
    });
    
    if (!approvalResponses) {
      this.addMessage({ role: 'user', content: prompt });
    }

    const model = createModel(this.config.providerType, this.config.model);
    const tools = this.buildTools() as ToolSet | undefined;
    const { systemPrompt, messages } = this.buildPromptContext();

    if (approvalResponses && approvalResponses.length > 0) {
      messages.push({
        role: 'tool',
        content: approvalResponses,
      });
    }

    // Log each tool's structure for debugging
    if (tools) {
      for (const [toolName, toolDef] of Object.entries(tools)) {
        const typedToolDef = toolDef as {
          execute?: unknown;
          inputSchema?: unknown;
          description?: unknown;
          needsApproval?: unknown;
        };
        logger.debug(`Tool ${toolName} structure:`, {
          hasExecute: typeof typedToolDef.execute === 'function',
          hasInputSchema: !!typedToolDef.inputSchema,
          description: typedToolDef.description,
          needsApproval: typedToolDef.needsApproval ?? true,
        });
      }
    }

    try {
      const result = streamText({
        model,
        system: systemPrompt,
        messages,
        tools,
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxTokens,
        stopWhen: stepCountIs(this.config.enableTools ? this.config.maxIterations : 1),
        abortSignal,
      });

      let finalResponse = '';

      for await (const part of result.fullStream) {
        if (part.type === 'text-delta' && part.text) {
          finalResponse += part.text;
          yield part.text;
          continue;
        }

        if (
          part.type === 'tool-input-start' ||
          part.type === 'tool-input-delta' ||
          part.type === 'tool-input-end' ||
          part.type === 'tool-call' ||
          part.type === 'tool-result' ||
          part.type === 'tool-error' ||
          part.type === 'tool-output-denied' ||
          part.type === 'tool-approval-request'
        ) {
          onStreamPart?.(part as { type: string; [key: string]: unknown });
        }
      }

      const responseObj = await result.response;
      const contentParts = await result.content;

      const approvalRequests: AgentToolApprovalRequest[] = [];
      for (const part of contentParts) {
        if (SimpleAgent.isApprovalRequestPart(part)) {
          approvalRequests.push(SimpleAgent.mapApprovalRequest(part));
        }
      }

      this.syncMessagesFromResponse(responseObj.messages);

      if (approvalRequests.length > 0) {
        this.pendingApprovalRequests = approvalRequests;

        return {
          response: finalResponse,
          toolCalls: undefined,
          toolApprovalRequests: approvalRequests,
          iterations: (await result.steps).length || 1,
        };
      }

      if (!finalResponse) {
        try {
          const streamedText = await Promise.resolve(result.text);
          if (streamedText) {
            yield streamedText;
            finalResponse = streamedText;
          }
        } catch {
          // Some tool-only steps can legitimately produce no text output.
          finalResponse = '';
        }
      }

      const agentResult: AgentResult = {
        response: finalResponse,
        iterations: (await result.steps).length || 1,
      };

      await this.executeHooks('afterGenerate', {
        agent: this,
        prompt,
        iteration: agentResult.iterations,
        state: this.getState(),
      });

      return agentResult;
    } catch (error) {
      logger.error('Stream failed', error);
      throw error;
    }
  }
}
