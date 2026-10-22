import { randomUUID } from 'node:crypto';
import type { AssistantMessage, Message as PiMessage } from '@earendil-works/pi-ai';

import { createLogger } from '@iki/backend/logger';
import {
  RefusalError,
  getErrorMessage,
  isContextOverflowError,
  isRetryableError,
} from '@iki/backend/utils/errors';
import type { ToolApprovalRequest } from '../types';
import { assembleRequestSystemPrompt } from '@iki/backend/message/system_prompt';
import { withRetry } from '@iki/backend/utils/retry';
import {
  appendUserPromptToHistory,
  cloneModelMessages,
  type ModelMessage,
  type ModelToolResultOutput,
} from '@iki/backend/message/model_history';
import {
  resolvePersonaPrompt,
  getProviderConfig,
  resolvePiModelCapability,
  resolveProviderApi,
} from '../../provider/llm/factory';
import {
  buildPiModel,
  callPiChat,
  projectHistoryToPiContext,
  projectToolsToPiTools,
} from '../../provider/llm/pi_adapter';
import {
  runPiAgentLoop,
  toolResultIsError as toolExecutionIsError,
  toolResultText as toolExecutionText,
  type PiLoopDelta,
  type PiLoopEvent,
  type PiLoopTool,
  type PiUsageBuckets,
} from './pi_agent_loop';
import { preparePiTurnHistory, compactPiRequestStep } from './pi_turn_budget';
import {
  createApprovalPolicyBox,
  advanceApprovalPolicySnapshot,
  resolveTools,
  type ApprovalPolicyBox,
} from '../harness/tool_resolver';
import {
  estimateTextTokens,
  estimateToolSchemaTokens,
} from '../context_budget';
import { getToolRuntimeContext, runWithToolRuntimeContext } from '../../utils/runtime_context';
import { resolveThreadWorkspaceSelectionSnapshot } from '../../workspaces/thread_workspace';
import type { AgentTool, AgentTurnPerf, AgentUsage } from '../types';
import type {
  HarnessConfig,
  InlineExecutionRecord,
  TurnEvent,
  TurnInput,
  TurnOutput,
} from '../harness/harness_types';
import { unwrapCheckpoint } from '../../runtimes/compaction_prompt';

const logger = createLogger({ module: 'pi_tool_turn_harness' });

export type PiToolModelCall = (
  config: HarnessConfig,
  request: {
    systemPrompt: string;

    messages: PiMessage[];
    tools?: ReturnType<typeof projectToolsToPiTools>;
    signal?: AbortSignal;
    maxTokens?: number;

    onRecoveryNote?: (noteText: string) => void;

    onContextOverflow?: () => Promise<void>;
  }
) => { events: AsyncIterable<PiLoopDelta>; final: Promise<AssistantMessage> };

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const CONTENT_FILTER_PATTERN = /content_filter/i;

const PER_REQUEST_COMPACT_PLACEHOLDER = '__iki_compaction_slot__';

const recoveryNoteFor = (failure: Error): string =>
  (failure instanceof RefusalError
    ? 'Your last response was blocked by content policies. Please rephrase your approach to comply with content policies while still being helpful, or find an alternative way to assist.'
    : `Your last attempt encountered an error: ${getErrorMessage(failure)}. Please try a different approach or simplify your response to avoid this issue.`) +
  '\n\n---\nContinue with the original task.';

export const withPiRetry = (
  attempt: () => { stream: AsyncIterable<PiStreamEvent>; final: Promise<AssistantMessage> },
  request: { messages: PiMessage[]; signal?: AbortSignal },
  onRecoveryNote?: (noteText: string) => void,

  onContextOverflow?: () => Promise<void>
): { events: AsyncIterable<PiLoopDelta>; final: Promise<AssistantMessage> } => {
  const queue: PiLoopDelta[] = [];
  let notify: (() => void) | undefined;
  let done = false;
  let overflowRetried = false;
  const pushDelta = (delta: PiLoopDelta) => {
    queue.push(delta);
    notify?.();
  };
  const waitDelta = () =>
    new Promise<void>(resolve => {
      notify = resolve;
    });

  const finalPromise = (async () => {
    try {
      let attemptIndex = 0;
      for (;;) {
        const one = attempt();
        let streamed = false;
        for await (const event of one.stream) {
          if (event.type === 'text_delta' && event.delta) {
            streamed = true;
            pushDelta({ type: 'text_delta', delta: event.delta });
          } else if (event.type === 'thinking_delta' && event.delta) {
            streamed = true;
            pushDelta({ type: 'thinking_delta', delta: event.delta });
          }
        }
        const final = await one.final;
        if (final.stopReason === 'error') {
          const failure = CONTENT_FILTER_PATTERN.test(final.errorMessage ?? '')
            ? new RefusalError(
                'Model response was blocked by content filter',
                'content-filter',
                undefined
              )
            : new Error(final.errorMessage || 'Provider returned an error stop reason');

          if (
            isContextOverflowError(final.errorMessage) &&
            onContextOverflow &&
            !overflowRetried &&
            !streamed &&
            !request.signal?.aborted
          ) {
            overflowRetried = true;
            attemptIndex = 0;
            logger.event({
              level: 'warn',
              event: 'llm.turn.retry',
              outcome: 'started',
              message:
                'Provider rejected the request for context length; compacted and retrying once.',
              data: {},
            });
            await onContextOverflow();
            continue;
          }
          if (
            attemptIndex < RETRY_MAX_ATTEMPTS &&
            !streamed &&
            !request.signal?.aborted &&
            isRetryableError(failure)
          ) {
            attemptIndex += 1;
            await sleep(
              Math.min(RETRY_BASE_DELAY_MS * 2 ** (attemptIndex - 1), RETRY_MAX_DELAY_MS)
            );
            const note = recoveryNoteFor(failure);

            request.messages.push({ role: 'user', content: note, timestamp: Date.now() });
            onRecoveryNote?.(note);
            logger.event({
              level: 'warn',
              event: 'llm.turn.retry',
              outcome: 'started',
              message: `Pi tool turn step failed, retrying (attempt ${attemptIndex}/${RETRY_MAX_ATTEMPTS})`,
              data: { errorMessage: getErrorMessage(failure) },
            });
            continue;
          }

          if (request.signal?.aborted) {
            throw new DOMException(final.errorMessage || 'Run cancelled', 'AbortError');
          }
          if (failure instanceof RefusalError) throw failure;
          logger.event({
            level: 'error',
            event: 'llm.turn.failed',
            outcome: 'failed',
            message: 'Pi tool turn step failed terminally.',
            data: { errorMessage: getErrorMessage(failure) },
          });
        }
        return final;
      }
    } finally {
      done = true;
      notify?.();
    }
  })();

  const events = (async function* () {
    let index = 0;
    for (;;) {
      while (index < queue.length) {
        yield queue[index];
        index += 1;
      }
      if (done) return;
      await waitDelta();
    }
  })();

  return { events, final: finalPromise };
};

export type PiStreamEvent = { type: 'text_delta' | 'thinking_delta'; delta: string };

const defaultPiToolModelCall: PiToolModelCall = (config, request) => {
  const provider = getProviderConfig(config.providerType, config.providerId);
  const capability = resolvePiModelCapability({
    providerType: config.providerType,
    ...(config.providerId ? { providerId: config.providerId } : {}),
    modelId: config.model,
  });
  const model = buildPiModel({
    id: config.model,
    providerType: config.providerType,
    baseUrl: provider.baseURL,

    api: resolveProviderApi(config.providerType, provider),
    contextWindow: capability?.contextWindow ?? 128000,
    maxTokens: config.maxOutputTokens ?? capability?.maxTokens ?? 4096,
    ...(capability?.input ? { input: capability.input } : {}),
    ...(capability?.cost ? { cost: capability.cost } : {}),
  });
  return withPiRetry(
    () => {
      const stream = callPiChat(
        model,
        { systemPrompt: request.systemPrompt, messages: request.messages, tools: request.tools },
        {
          apiKey: provider.apiKey,
          ...(request.signal ? { signal: request.signal } : {}),
          ...(typeof request.maxTokens === 'number' ? { maxTokens: request.maxTokens } : {}),
        }
      );
      return {
        stream: stream as unknown as AsyncIterable<PiStreamEvent>,
        final: stream.result(),
      };
    },
    request,
    request.onRecoveryNote,
    request.onContextOverflow
  );
};

const createRawToolRunner = (
  tools: AgentTool[],
  config: HarnessConfig,
  inheritedBox?: { selection: unknown }
) => {
  const byName = new Map(tools.map(tool => [tool.name, tool]));

  const workspaceSelectionBox = inheritedBox ??
    getToolRuntimeContext().workspaceSelectionBox ?? {
      selection: config.threadId ? resolveThreadWorkspaceSelectionSnapshot(config.threadId) : null,
    };
  return async (
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown> => {
    const tool = byName.get(toolName);
    if (!tool) {
      throw new Error(`Unknown tool "${toolName}".`);
    }
    return runWithToolRuntimeContext(
      {
        ...getToolRuntimeContext(),
        ...(config.threadId ? { threadId: config.threadId } : {}),
        abortSignal: signal,
        availableTools: tools,
        availableSkillIds: config.availableSkillIds,
        workspaceSelectionBox,
      },
      async () => {
        const invoke = () => tool.handler(structuredClone(args));
        return tool.retry ? withRetry(invoke, tool.retry)() : invoke();
      }
    );
  };
};

const defaultPiToolExecutor = (
  tools: AgentTool[],
  config: HarnessConfig,
  inheritedBox?: { selection: unknown }
) => {
  const runRaw = createRawToolRunner(tools, config, inheritedBox);
  return async (
    call: { name: string; arguments: Record<string, unknown> },
    signal?: AbortSignal
  ): Promise<ToolResultOutput> => {
    try {
      const value = await runRaw(call.name, call.arguments, signal);
      return typeof value === 'string'
        ? { type: 'text', value }
        : { type: 'json', value: JSON.parse(JSON.stringify(value ?? null)) };
    } catch (error) {
      return { type: 'error-text', value: getErrorMessage(error) };
    }
  };
};

export type ToolExecutionOutcome =
  | { kind: 'pending' | 'unknown' | 'busy' }
  | {
      kind: 'completed';
      reused: boolean;
      result: { type: 'tool-result'; toolCallId: string; toolName: string; output: unknown };
    };

type ToolResultOutput =
  | { type: 'text'; value: string }
  | { type: 'json'; value: unknown }
  | { type: 'error-text'; value: string };

export class PiToolTurnHarness {
  private readonly config: HarnessConfig;
  private readonly modelCall: PiToolModelCall;
  private readonly resume?: {
    commands: Array<{
      approvalId: string;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }>;
    owner: {
      prepare: (address: { threadId: string; approvalId: string }) => void;
      executeApproved: (
        address: { threadId: string; approvalId: string },
        port: {
          signal?: AbortSignal;
          execute: (toolName: string, args: unknown) => Promise<unknown>;
        }
      ) => Promise<ToolExecutionOutcome>;
    };
  };
  private history: ModelMessage[] = [];

  private workspaceSelectionBox?: { selection: unknown };

  private approvalPredicates = new Map<
    string,
    (input: unknown, options?: unknown) => boolean | Promise<boolean>
  >();

  private policyBox?: ApprovalPolicyBox;

  constructor(
    config: HarnessConfig,
    deps?: {
      modelCall?: PiToolModelCall;

      resume?: {
        commands: Array<{
          approvalId: string;
          toolCallId: string;
          toolName: string;
          args: Record<string, unknown>;
        }>;
        owner: {
          prepare: (address: { threadId: string; approvalId: string }) => void;
          executeApproved: (
            address: { threadId: string; approvalId: string },
            port: {
              signal?: AbortSignal;
              execute: (toolName: string, args: unknown) => Promise<unknown>;
            }
          ) => Promise<ToolExecutionOutcome>;
        };
      };
    }
  ) {
    this.config = config;
    this.modelCall = deps?.modelCall ?? defaultPiToolModelCall;
    this.resume = deps?.resume;
  }

  async *turn(input: TurnInput): AsyncGenerator<TurnEvent, void> {
    const signal = input.abortSignal;
    signal?.throwIfAborted();

    const recordInlineExecution = input.recordInlineExecution;
    const runId = input.runId;

    this.policyBox = createApprovalPolicyBox(this.config.approvalPolicy);
    const policyBox = this.policyBox;

    const tools =
      input.toolsOverride ??
      resolveTools({
        enableTools: this.config.enableTools,
        enabledToolNames: this.config.enabledToolNames,
        availableSkillIds: this.config.availableSkillIds,
        requireApproval: this.config.requireApproval,
        autoApproveToolRequests: this.config.autoApproveToolRequests ?? false,
        ...(this.config.approvalPolicy ? { approvalPolicy: this.config.approvalPolicy } : {}),
        approvalPolicyBox: policyBox,
      });

    this.workspaceSelectionBox = getToolRuntimeContext().workspaceSelectionBox ?? {
      selection: this.config.threadId
        ? resolveThreadWorkspaceSelectionSnapshot(this.config.threadId)
        : null,
    };
    const piTools = tools.length
      ? projectToolsToPiTools(
          tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          }))
        )
      : undefined;

    if (!input.toolsOverride) {

      this.approvalPredicates.clear();
      for (const tool of tools) {
        if (typeof tool.needsApproval === 'function') {
          this.approvalPredicates.set(tool.name, tool.needsApproval);
        }
      }
    }
    const loopTools: PiLoopTool[] | undefined = piTools?.map(piTool => {
      const agentTool = tools.find(candidate => candidate.name === piTool.name);
      const predicate = this.approvalPredicates.get(piTool.name);

      if (predicate) {
        return {
          ...piTool,

          needsApproval: async (
            input: unknown,
            context: { toolCallId: string; messages: PiMessage[] }
          ) => Boolean(await predicate(input, context)),
        };
      }
      return {
        ...piTool,
        needsApproval:
          typeof agentTool?.needsApproval === 'function'
            ? (input: unknown, context: { toolCallId: string; messages: PiMessage[] }) => {
                const decide = agentTool.needsApproval;
                return Boolean(
                  typeof decide === 'function' ? decide(input, context) : decide === true
                );
              }
            : agentTool?.needsApproval === true,
      };
    });
    const toolSchemaTokens = tools.length ? estimateToolSchemaTokens(tools) : undefined;

    this.history = this.buildTurnHistory(input.history, input.prompt);

    const personaPrompt = resolvePersonaPrompt(this.config.providerType, this.config.providerId);
    const firstTranscriptSystem = this.history.find(
      (message): message is Extract<ModelMessage, { role: 'system' }> => message.role === 'system'
    );

    const toolSchemaOverheadTokens = piTools ? estimateTextTokens(JSON.stringify(piTools)) : 0;
    const transcriptSystemText =
      typeof firstTranscriptSystem?.content === 'string' ? firstTranscriptSystem.content : '';
    const { requestHistory, summaryMessage: turnStartSummaryMessage } = await preparePiTurnHistory({
      history: this.history,
      personaPrompt,
      planPrompt: this.config.systemPrompt,
      transcriptSystemText,
      toolSchemaTokens: toolSchemaOverheadTokens,
      ...(typeof this.config.maxInputTokens === 'number'
        ? { maxInputTokens: this.config.maxInputTokens }
        : {}),
      ...(this.config.threadId ? { threadId: this.config.threadId } : {}),
      ...(signal ? { signal } : {}),
    });

    const projected = projectHistoryToPiContext(
      requestHistory,
      this.config.model,
      this.config.providerType
    );
    const { prompt: systemPrompt } = assembleRequestSystemPrompt([
      { slot: 'persona', text: personaPrompt },
      { slot: 'planPrompt', text: this.config.systemPrompt },
      { slot: 'transcriptSystem', text: projected.systemPrompt },
    ]);

    const transcript: PiMessage[] = projected.messages;
    let requestView: ModelMessage[] = requestHistory;
    let summaryMessage = turnStartSummaryMessage;

    let requestSystemPrompt = systemPrompt;
    const overheadTokens = estimateTextTokens(systemPrompt) + toolSchemaOverheadTokens;
    const turnStartedAt = Date.now();
    let firstDeltaMs: number | null = null;
    let streamedText = '';
    let llmMs = 0;
    let toolMs = 0;
    let toolCallsCount = 0;
    let lastStepUsage: AgentUsage | undefined;
    const pendingNotes: ModelMessage[] = [];
    const toolCallResults: Array<{
      toolName: string;
      args: Record<string, unknown>;
      result?: unknown;
    }> = [];

    const executor = this.buildExecutor({
      tools,
      recordInlineExecution,
      runId,
    });


    if (this.resume && this.resume.commands.length > 0) {
      if (!this.config.threadId) {
        throw new Error('Resuming an approval requires the paused turn thread id.');
      }
      for (const command of this.resume.commands) {
        const address = { threadId: this.config.threadId, approvalId: command.approvalId };
        yield {
          event: 'step',
          step: {
            type: 'tool_execution_start',
            toolCallId: command.toolCallId,
            toolName: command.toolName,
            input: command.args,
          },
        };
        this.resume.owner.prepare(address);

        const ownerSignal = signal ?? new AbortController().signal;

        const runRaw = createRawToolRunner(tools, this.config, this.workspaceSelectionBox);
        const outcome = await this.resume.owner.executeApproved(address, {
          signal: ownerSignal,
          execute: (toolName, args) =>
            runRaw(toolName, args as Record<string, unknown>, ownerSignal),
        });
        if (outcome.kind !== 'completed') {
          throw new Error(
            `Approved tool "${command.toolName}" could not be executed (${outcome.kind}); the turn cannot continue honestly.`
          );
        }
        toolCallsCount += 1;
        const output = outcome.result.output as ModelToolResultOutput;
        const isError = toolExecutionIsError(output);
        toolCallResults.push({
          toolName: outcome.result.toolName,
          args: command.args,
          result: output,
        });
        yield {
          event: 'step',
          step: {
            type: 'tool_execution_end',
            toolCallId: outcome.result.toolCallId,
            outcome: isError ? ('error' as const) : ('success' as const),
            output,
            ...(isError ? { error: toolOutputText(output) } : {}),
          },
        };

        const resumeResultMessage: ModelMessage = {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: outcome.result.toolCallId,
              toolName: outcome.result.toolName,
              output,
            },
          ],
        };
        this.history = [...this.history, resumeResultMessage];
        requestView = [...requestView, resumeResultMessage];
        transcript.push({
          role: 'toolResult',
          toolCallId: outcome.result.toolCallId,
          toolName: outcome.result.toolName,
          content: [{ type: 'text', text: toolExecutionText(output) }],
          isError,
          timestamp: Date.now(),
        });
      }
    }

    const pendingApprovalRequests: ToolApprovalRequest[] = [];

    const applyCompaction = async ({ force }: { force: boolean }): Promise<boolean> => {
      if (typeof this.config.maxInputTokens !== 'number') return false;
      const compactionStartedAt = Date.now();
      const planned = await compactPiRequestStep({
        requestView,
        maxInputTokens: this.config.maxInputTokens,
        overheadTokens,
        ...(force ? { force: true } : {}),
        ...(this.config.threadId ? { threadId: this.config.threadId } : {}),
        ...(signal ? { signal } : {}),
        ...(summaryMessage && typeof summaryMessage.content === 'string'
          ? { existingSummary: unwrapCheckpoint(summaryMessage.content) }
          : {}),

        ...(summaryMessage ? { previousSummaryMessage: summaryMessage } : {}),
      });
      if (planned.viewTokens + overheadTokens > this.config.maxInputTokens) {
        throw new Error(
          'Context budget exceeded by protected instructions or the current turn; history has been preserved.'
        );
      }
      if (!planned.compacted) return false;
      requestView = planned.requestView;
      summaryMessage = planned.summaryMessage;

      const rebuilt = projectHistoryToPiContext(
        [{ role: 'system', content: PER_REQUEST_COMPACT_PLACEHOLDER }, ...requestView],
        this.config.model,
        this.config.providerType
      );
      transcript.splice(
        0,
        transcript.length,
        ...rebuilt.messages.filter(
          message => !(message.role === 'system' && message.content === transcriptSystemText)
        )
      );
      requestSystemPrompt = assembleRequestSystemPrompt([
        { slot: 'persona', text: personaPrompt },
        { slot: 'planPrompt', text: this.config.systemPrompt },
        { slot: 'transcriptSystem', text: transcriptSystemText },
      ]).prompt;
      logger.event({
        level: 'info',
        outcome: 'succeeded',
        event: 'llm.context.compacted',
        message: force
          ? 'Pi tool turn request view compacted (over-length rescue).'
          : 'Pi tool turn request view compacted mid-turn.',
        data: {
          omittedCount: planned.omittedCount,
          viewTokens: planned.viewTokens,
          durationMs: Date.now() - compactionStartedAt,
        },
      });
      return true;
    };

    const onContextOverflow = async (): Promise<void> => {
      const compacted = await applyCompaction({ force: true });
      if (!compacted) {
        throw new Error(
          'Context over length and compaction could not shrink it; history has been preserved.'
        );
      }
      for (const note of pendingNotes) {
        transcript.push({
          role: 'user',
          content: typeof note.content === 'string' ? note.content : '',
          timestamp: Date.now(),
        });
      }
    };

    const iterator = runPiAgentLoop({
      systemPrompt,
      messages: transcript,
      ...(loopTools ? { tools: loopTools } : {}),
      maxSteps: this.config.maxIterations,

      requestApproval: async call => {
        pendingApprovalRequests.push({
          approvalId: randomUUID(),
          toolCallId: call.id,
          toolCall: { toolName: call.name, args: call.arguments },
        });
      },
      callModel: async (context: {
        systemPrompt: string;
        messages: PiMessage[];
        tools?: unknown;
        steps?: ReadonlyArray<{ toolCalls: ReadonlyArray<{ name: string }> }>;
      }) => {

        if (typeof this.config.maxInputTokens === 'number') {
          await applyCompaction({ force: false });
        }

        return this.modelCall(this.config, {
          systemPrompt: requestSystemPrompt,
          messages: context.messages,
          tools: piTools,
          ...(signal ? { signal } : {}),
          ...(typeof this.config.maxOutputTokens === 'number'
            ? { maxTokens: this.config.maxOutputTokens }
            : {}),
          onRecoveryNote: noteText => {
            pendingNotes.push({ role: 'user', content: noteText });
          },
          onContextOverflow,
        });
      },
      executeTool: async call => {
        const startedAt = Date.now();
        toolCallsCount += 1;
        const output = await executor(call, signal);
        toolMs += Math.max(0, Date.now() - startedAt);
        return output;
      },
      ...(signal ? { signal } : {}),
    });

    let next = await iterator.next();
    while (!next.done) {
      const event = next.value as PiLoopEvent;
      if (event.type === 'text_delta') {
        if (firstDeltaMs === null) firstDeltaMs = Date.now() - turnStartedAt;
        streamedText += event.delta;
        yield {
          event: 'step',
          step: { type: 'message_update', text: event.delta, kind: 'text' },
        };
      } else if (event.type === 'thinking_delta') {
        if (firstDeltaMs === null) firstDeltaMs = Date.now() - turnStartedAt;
        yield {
          event: 'step',
          step: { type: 'message_update', text: event.delta, kind: 'reasoning' },
        };
      } else if (event.type === 'step_end') {
        const step = event.step;

        advanceApprovalPolicySnapshot(policyBox, this.config.approvalPolicy);

        if (pendingNotes.length > 0) {
          this.history = [...this.history, ...pendingNotes];
          requestView = [...requestView, ...pendingNotes];
          pendingNotes.length = 0;
        }
        lastStepUsage = mapBuckets(step.usage);

        const assistantParts: Array<
          | { type: 'text'; text: string }
          | { type: 'reasoning'; text: string }
          | {
              type: 'tool-call';
              toolCallId: string;
              toolName: string;
              input: Record<string, unknown>;
            }
        > = [];
        if (step.thinking) assistantParts.push({ type: 'reasoning', text: step.thinking });
        if (step.text) assistantParts.push({ type: 'text', text: step.text });
        for (const call of step.toolCalls) {
          assistantParts.push({
            type: 'tool-call',
            toolCallId: call.id,
            toolName: call.name,
            input: call.arguments,
          });
        }
        const assistantEntry: ModelMessage = { role: 'assistant', content: assistantParts };
        this.history = [...this.history, assistantEntry];
        requestView = [...requestView, assistantEntry];

        const stepUsage: AgentUsage = mapBuckets(step.usage);
        input.onInference?.({
          content: assistantParts,
          finishReason: step.toolCalls.length > 0 ? 'tool-calls' : 'stop',
          usage: stepUsage,
        });
      } else if (event.type === 'tool_start') {

        yield {
          event: 'step',
          step: {
            type: 'tool_execution_start',
            toolCallId: event.call.id,
            toolName: event.call.name,
            input: event.call.arguments,
          },
        };
      } else {
        const isError = toolExecutionIsError(event.output);
        toolCallResults.push({
          toolName: event.call.name,
          args: event.call.arguments,
          result: event.output,
        });
        yield {
          event: 'step',
          step: {
            type: 'tool_execution_end',
            toolCallId: event.call.id,
            outcome: isError ? ('error' as const) : ('success' as const),
            output: event.output,
            ...(isError ? { error: toolOutputText(event.output) } : {}),
          },
        };
        const toolResultEntry: ModelMessage = {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: event.call.id,
              toolName: event.call.name,
              output: event.output as ModelToolResultOutput,
            },
          ],
        };
        this.history = [...this.history, toolResultEntry];
        requestView = [...requestView, toolResultEntry];
      }
      next = await iterator.next();
    }
    const outcome = next.value;
    llmMs = Math.max(0, Date.now() - turnStartedAt - toolMs);

    const usage: AgentUsage = mapBuckets(outcome.usage);
    const perf: AgentTurnPerf = {
      llmMs,
      toolMs,
      firstTokenMs: firstDeltaMs ?? 0,
      firstTokenSamples: firstDeltaMs === null ? 0 : 1,
      toolCalls: toolCallsCount,
      steps: outcome.steps.length,
    };

    const awaitingApproval = outcome.status === 'awaiting-approval';
    if (awaitingApproval && pendingApprovalRequests.length === 0) {
      throw new Error('Pi tool turn paused for approval without any recorded approval request.');
    }
    if (
      outcome.status === 'completed' &&
      toolCallResults.length === 0 &&
      !outcome.finalText.trim() &&
      !streamedText.trim()
    ) {
      throw new RefusalError(
        'Model returned an empty response with no tool calls',
        'stop',
        undefined
      );
    }

    const text = streamedText || outcome.finalText;
    const finishReason = outcome.status === 'budget-exhausted' ? 'tool-calls' : 'stop';
    yield {
      event: 'step',
      step: { type: 'turn_end', outcome: 'completed', text, usage },
    };
    if (awaitingApproval) {

      yield {
        event: 'step',
        step: { type: 'approval_request', requests: pendingApprovalRequests },
      };
    }
    const output: TurnOutput = {
      text,
      usage,

      ...(lastStepUsage && lastStepUsage.inputTokens > 0
        ? { lastStepInputTokens: lastStepUsage.inputTokens }
        : {}),
      perf,
      ...(toolSchemaTokens ? { toolSchemaTokens } : {}),
      requiresApproval: awaitingApproval,

      pendingToolCalls: outcome.pendingToolCalls,
      finishReason: awaitingApproval ? undefined : finishReason,
      ...(toolCallResults.length > 0 ? { toolCalls: toolCallResults } : {}),
      ...(awaitingApproval ? { toolApprovalRequests: pendingApprovalRequests } : {}),
    };
    yield { event: 'done', output };
  }

  getHistory(): ModelMessage[] {
    return cloneModelMessages(this.history);
  }


  private buildExecutor(params: {
    tools: AgentTool[];
    recordInlineExecution?: (execution: InlineExecutionRecord) => void;
    runId?: string;
  }) {
    const { tools, recordInlineExecution, runId } = params;
    return async (
      call: { id?: string; name: string; arguments: Record<string, unknown> },
      execSignal?: AbortSignal
    ) => {
      const output = (await defaultPiToolExecutor(
        tools,
        this.config,
        this.workspaceSelectionBox
      )(call, execSignal)) as {
        type: string;
      };

      if (
        recordInlineExecution &&
        runId &&
        output.type !== 'error-text' &&
        output.type !== 'execution-denied'
      ) {
        recordInlineExecution({
          runId,
          toolCallId: call.id ?? '',
          toolName: call.name,
          args: call.arguments,
          output,
        });
      }
      return output;
    };
  }

  private buildTurnHistory(history: ModelMessage[] | undefined, prompt: string): ModelMessage[] {
    const base = cloneModelMessages(history);

    if (!prompt.trim() && base.length > 0) return base;
    return appendUserPromptToHistory(base, prompt);
  }
}

const mapBuckets = (buckets: PiUsageBuckets): AgentUsage => ({

  inputTokens: buckets.input + buckets.cacheRead + buckets.cacheWrite,
  outputTokens: buckets.output,
  cacheReadTokens: buckets.cacheRead,
  cacheWriteTokens: buckets.cacheWrite,
  reasoningTokens: buckets.reasoning,
  totalTokens: buckets.totalTokens,
  estimatedCostUsd: buckets.costUsd,
});

const toolOutputText = (output: unknown): string => {
  if (output !== null && typeof output === 'object' && 'type' in output) {
    const o = output as { type: string; value?: unknown; reason?: unknown };
    if (o.type === 'execution-denied') {
      return typeof o.reason === 'string' ? o.reason : 'Tool execution was denied';
    }
  }
  return output !== null && typeof output === 'object' && 'value' in output
    ? String((output as { value: unknown }).value)
    : 'Tool execution failed';
};
