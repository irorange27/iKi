import { generateText, smoothStream, stepCountIs, streamText, type ModelMessage, type ToolSet } from 'ai';

import { createLogger } from '../../logger';
import { RefusalError } from '../../../shared/utils/errors';
import {
  createModel,
  disposeLanguageModel,
  getModelGenerationSettings,
} from '../../provider/llm/factory';
import { normalizeLanguageModelUsage } from '../../provider/llm/usage';
import { ToolRegistry } from '../../tools/base';
import {
  appendApprovalResponsesToHistory,
  appendResponseMessages,
  appendUserPromptToHistory,
  buildAiToolSet,
  buildPromptContext,
  cloneModelMessages,
  collectApprovalRequests,
  collectToolCalls,
  loadAgentConfig,
  validateAgentConfig,
} from '../ai_sdk_runtime';
import type { AgentConfig, AgentResult, AgentTool, PartialAgentConfig } from '../types';
import type {
  ConversationRunner,
  ConversationRunnerGenerateRequest,
  ConversationRunnerStreamRequest,
} from './conversation_runner';

const simpleConversationLogger = createLogger({ module: 'simple_conversation_runner' });

type RunnerPrepareStep = Parameters<typeof generateText>[0]['prepareStep'];

export class SimpleConversationRunner implements ConversationRunner {
  private readonly config: AgentConfig;
  private readonly toolRegistry = new ToolRegistry();
  private readonly prepareStep: RunnerPrepareStep;
  private history: ModelMessage[] = [];

  constructor(
    config?: PartialAgentConfig & {
      prepareStep?: RunnerPrepareStep;
    }
  ) {
    this.prepareStep = config?.prepareStep;
    this.config = loadAgentConfig(config);
  }

  registerTool(tool: AgentTool): void {
    this.toolRegistry.register(tool);
  }

  getHistory(): ModelMessage[] {
    return cloneModelMessages(this.history);
  }

  private resolveBaseHistory(history?: ModelMessage[]): ModelMessage[] {
    if (history !== undefined) {
      return cloneModelMessages(history);
    }

    return cloneModelMessages(this.history);
  }

  private buildTurnHistory(
    history: ModelMessage[] | undefined,
    prompt: string,
    approvalResponses?: ConversationRunnerStreamRequest['approvalResponses']
  ): ModelMessage[] {
    const baseHistory = this.resolveBaseHistory(history);

    if (approvalResponses && approvalResponses.length > 0) {
      return appendApprovalResponsesToHistory(baseHistory, approvalResponses);
    }

    return appendUserPromptToHistory(baseHistory, prompt);
  }

  private buildToolSet(): ToolSet | undefined {
    return buildAiToolSet(
      {
        enableTools: this.config.enableTools,
        providerType: this.config.providerType,
      },
      this.toolRegistry.getAll()
    ) as ToolSet | undefined;
  }

  private persistHistory(history: ModelMessage[], responseMessages: unknown): void {
    this.history = appendResponseMessages(history, responseMessages);
  }

  async generate(request: ConversationRunnerGenerateRequest): Promise<AgentResult> {
    validateAgentConfig(this.config);

    const model = createModel(this.config.providerType, this.config.model, this.config.providerId);
    const tools = this.buildToolSet();
    const history = this.buildTurnHistory(request.history, request.prompt);
    const { systemPrompt, messages } = buildPromptContext(this.config, history);

    const generationSpan = simpleConversationLogger.span({
      level: 'debug',
      event: 'conversation.generate',
      data: {
        model: this.config.model,
        provider_type: this.config.providerType,
        tool_count: tools ? Object.keys(tools).length : 0,
        message_count: messages.length,
      },
    });

    try {
      const result = await generateText({
        model,
        system: systemPrompt,
        messages,
        tools,
        ...(this.prepareStep ? { prepareStep: this.prepareStep } : {}),
        ...getModelGenerationSettings({
          providerType: this.config.providerType,
          modelId: this.config.model,
          providerId: this.config.providerId,
          temperature: this.config.temperature,
        }),
        maxOutputTokens: this.config.maxTokens,
        stopWhen: stepCountIs(this.config.enableTools ? this.config.maxIterations : 1),
        onStepFinish: async ({
          toolCalls,
          toolResults,
        }: {
          toolCalls?: unknown[];
          toolResults?: unknown[];
        }) => {
          simpleConversationLogger.event({
            level: 'debug',
            event: 'conversation.generate.step',
            outcome: 'succeeded',
            data: {
              tool_call_count: toolCalls?.length ?? 0,
              tool_result_count: toolResults?.length ?? 0,
            },
          });
        },
      });

      this.persistHistory(history, result.response.messages);

      const toolApprovalRequests = collectApprovalRequests(result.content);
      const toolCalls = collectToolCalls(result.steps, result.toolCalls);

      generationSpan.succeed({
        data: {
          iterations: result.steps?.length || 1,
          tool_call_count: toolCalls?.length ?? 0,
          approval_request_count: toolApprovalRequests.length,
        },
      });

      return {
        response: result.text,
        ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
        ...(toolApprovalRequests.length > 0 ? { toolApprovalRequests } : {}),
        usage: normalizeLanguageModelUsage(result.totalUsage || result.usage),
        iterations: result.steps?.length || 1,
      };
    } catch (error) {
      generationSpan.fail(error, {
        data: {
          message_count: messages.length,
          tool_count: tools ? Object.keys(tools).length : 0,
        },
      });
      throw error;
    } finally {
      disposeLanguageModel(model);
    }
  }

  async *stream(
    request: ConversationRunnerStreamRequest
  ): AsyncGenerator<string, AgentResult, unknown> {
    validateAgentConfig(this.config);

    const model = createModel(this.config.providerType, this.config.model, this.config.providerId);
    const tools = this.buildToolSet();
    const history = this.buildTurnHistory(
      request.history,
      request.prompt,
      request.approvalResponses
    );
    const { systemPrompt, messages } = buildPromptContext(this.config, history);

    try {
      const result = streamText({
        model,
        system: systemPrompt,
        messages,
        tools,
        ...(this.prepareStep ? { prepareStep: this.prepareStep } : {}),
        ...getModelGenerationSettings({
          providerType: this.config.providerType,
          modelId: this.config.model,
          providerId: this.config.providerId,
          temperature: this.config.temperature,
        }),
        maxOutputTokens: this.config.maxTokens,
        stopWhen: stepCountIs(this.config.enableTools ? this.config.maxIterations : 1),
        abortSignal: request.abortSignal,
        experimental_transform: smoothStream(),
        onAbort: () => {
          simpleConversationLogger.event({
            level: 'info',
            event: 'conversation.stream.abort',
            outcome: 'cancelled',
            data: {
              provider: this.config.providerType,
              model: this.config.model,
              tool_count: tools ? Object.keys(tools).length : 0,
              message_count: messages.length,
            },
          });
        },
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
          request.onStreamPart?.(part as { type: string; [key: string]: unknown });
        }
      }

      const responseObj = await result.response;
      const contentParts = await result.content;
      const totalUsage = normalizeLanguageModelUsage(await Promise.resolve(result.totalUsage));
      const finishReason: string | undefined = await Promise.resolve(result.finishReason).catch((): undefined => undefined);

      // Detect model refusals
      if (finishReason === 'content-filter') {
        throw new RefusalError(
          'Model response was blocked by content filter',
          finishReason,
          finalResponse || undefined
        );
      }

      if (finishReason === 'error') {
        throw new RefusalError(
          `Model produced an error response${finalResponse ? `: ${finalResponse.slice(0, 200)}` : ''}`,
          finishReason,
          finalResponse || undefined
        );
      }

      this.persistHistory(history, responseObj.messages);

      const approvalRequests = collectApprovalRequests(contentParts);
      const hadToolCalls = (await result.steps).some(
        step => (step.toolCalls?.length ?? 0) > 0
      );
      if (approvalRequests.length > 0) {
        return {
          response: finalResponse,
          toolApprovalRequests: approvalRequests,
          usage: totalUsage,
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
          finalResponse = '';
        }
      }

      // Detect soft refusals: empty or short refusal-like response with no tool calls
      if (!hadToolCalls && !finalResponse.trim()) {
        throw new RefusalError(
          'Model returned an empty response with no tool calls',
          finishReason,
          undefined
        );
      }

      return {
        response: finalResponse,
        usage: totalUsage,
        iterations: (await result.steps).length || 1,
      };
    } finally {
      disposeLanguageModel(model);
    }
  }
}

export const createSimpleConversationRunner = (
  config?: PartialAgentConfig & {
    prepareStep?: RunnerPrepareStep;
  }
): ConversationRunner => new SimpleConversationRunner(config);
