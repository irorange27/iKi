import type { Message as PiMessage } from '@earendil-works/pi-ai';

import { createLogger } from '@iki/core/logger';
import { RefusalError } from '@iki/core/utils/errors';
import type { AgentTool, AgentTurnPerf, AgentUsage } from '../types';
import { assembleRequestSystemPrompt } from '@iki/llm/message/system_prompt';
import {
  appendUserPromptToHistory,
  cloneModelMessages,
  toolResultIsError as toolExecutionIsError,
  toolResultText,
  type ModelMessage,
  type ModelToolResultOutput,
} from '@iki/llm/message/model_history';
import { resolvePersonaPrompt } from '@iki/llm-pi-ai/factory';
import {
  projectHistoryToPiContext,
  projectToolsToPiTools,
  projectUsageToIki,
} from '@iki/llm-pi-ai/pi_adapter';
import {
  runAgentLoop,
  type LoopEvent,
  type LoopTool,
  type LoopUsageBuckets,
} from '@iki/agent-loop';
import { preparePiTurnHistory, compactPiRequestStep } from './turn_budget';
import { resolveTools } from '../harness/tool_resolver';
import {
  estimateTextTokens,
  estimateToolSchemaTokens,
} from '../context_budget';
import { getToolRuntimeContext } from '@iki/core/utils/runtime_context';
import { resolveThreadWorkspaceSelectionSnapshot } from '../../workspaces/thread_workspace';
import type {
  HarnessConfig,
  InlineExecutionRecord,
  TurnEvent,
  TurnInput,
  TurnOutput,
} from '../harness/harness_types';
import { unwrapCheckpoint } from '../../runtimes/compaction_prompt';

const logger = createLogger({ module: 'pi_tool_turn_harness' });

import { defaultPiToolModelCall, type PiToolModelCall, withPiRetry } from './tool_model_call';
import { defaultPiToolExecutor } from './tool_executor';

export { withPiRetry, defaultPiToolModelCall };
export type { PiToolModelCall };
export { defaultPiToolExecutor };

const PER_REQUEST_COMPACT_PLACEHOLDER = '__iki_compaction_slot__';

export class PiToolTurnHarness {
  private readonly config: HarnessConfig;
  private readonly modelCall: PiToolModelCall;
  private history: ModelMessage[] = [];

  private workspaceSelectionBox?: { selection: unknown };

  constructor(
    config: HarnessConfig,
    deps?: {
      modelCall?: PiToolModelCall;
    }
  ) {
    this.config = config;
    this.modelCall = deps?.modelCall ?? defaultPiToolModelCall;
  }

  async *turn(input: TurnInput): AsyncGenerator<TurnEvent, void> {
    const signal = input.abortSignal;
    signal?.throwIfAborted();

    const recordInlineExecution = input.recordInlineExecution;
    const runId = input.runId;

    const tools =
      input.toolsOverride ??
      resolveTools({
        enableTools: this.config.enableTools,
        enabledToolNames: this.config.enabledToolNames,
        availableSkillIds: this.config.availableSkillIds,
        requireApproval: false,
        autoApproveToolRequests: true,
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

    const loopTools: LoopTool[] | undefined = piTools;
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
    const systemPrompt = assembleRequestSystemPrompt([
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
      ]);
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

    const iterator = runAgentLoop({
      systemPrompt,
      messages: transcript,
      ...(loopTools ? { tools: loopTools } : {}),
      maxSteps: this.config.maxIterations,
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
      const event = next.value as LoopEvent;
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
    const output: TurnOutput = {
      text,
      usage,

      ...(lastStepUsage && lastStepUsage.inputTokens > 0
        ? { lastStepInputTokens: lastStepUsage.inputTokens }
        : {}),
      perf,
      ...(toolSchemaTokens ? { toolSchemaTokens } : {}),
      requiresApproval: false,
      finishReason,
      ...(toolCallResults.length > 0 ? { toolCalls: toolCallResults } : {}),
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

const mapBuckets = (buckets: LoopUsageBuckets): AgentUsage =>
  projectUsageToIki(buckets, buckets.costUsd);

// Lenient wire projection (model_history): String()'ing object values used to
// render "[object Object]" on this display path.
const toolOutputText = (output: unknown): string =>
  output === null || typeof output !== 'object' || !('type' in output)
    ? 'Tool execution failed'
    : toolResultText(output);
