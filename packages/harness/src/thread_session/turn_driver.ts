import type { ModelMessage } from '@iki/llm/message/model_history';

import { addTurnPerf, type AgentStep, type AgentTurnPerf } from '@iki/harness/agent';
import type { ConversationPreview } from '@iki/core/types/companion';
import { runWithToolRuntimeContext } from '@iki/core/utils/runtime_context';
import type { CompactionCheckpointRecord, TurnDriverHarness } from '../agent/harness';
import type { AgentRunTracker } from './run_tracker';
import type { ExecutionPlan } from './execution_plan';
import {
  recordSessionEvents,
  STEERING_INPUT_ACCEPTED,
  SESSION_EVENT_VERSION,
  type SteeringInputAcceptedPayload,
} from './session_log';
import { createTextCommitGate } from './text_commit_gate';
import { getCompanion } from './platform';
import type { ActiveStreamState, ChatStreamEvent, ChatStreamTarget, UiChunkEmitter } from './types';

type TurnDriverResultBase = {
  response?: string;
  usage?: import('@iki/harness/agent').AgentResult['usage'];

  lastStepInputTokens?: number;

  perf?: AgentTurnPerf;

  toolSchemaTokens?: { builtin: number; mcp: number };
};

type HarnessTurnResult = import('@iki/harness/agent').AgentResult;

export type TurnDriverResult =
  | (TurnDriverResultBase & { outcome: 'completed' })
  | (TurnDriverResultBase & { outcome: 'budget-exhausted' })
  | (TurnDriverResultBase & { outcome: 'cancelled' })
  | (TurnDriverResultBase & { outcome: 'partial-failure' });

type TurnDriverState = {

  harness: TurnDriverHarness;
  runTracker: AgentRunTracker;
  streamHistory: ModelMessage[];
  streamPrompt: string;

  workspaceSelectionBox?: { selection: unknown };
  accumulatedResponse: string;
  batchIndex: number;
  turnHadToolCalls: boolean;

  lastFacts: TurnDriverResultBase;
};

export type TurnDriverDeps = {
  target: ChatStreamTarget;

  plan: ExecutionPlan;
  streamState: ActiveStreamState;
  uiChunkEmitter: UiChunkEmitter;
  notifyRunStatus: () => void;
  drainSteerMessages: () => string[];

  conversationPreview?: boolean;

  onToolActivity?: () => void;

  onRunIdChanged?: (runId: string) => void;
  onCompacted?: (checkpoint: CompactionCheckpointRecord) => void;

  registerChildRunAlias?: (parentRunId: string, childRunId: string) => () => void;
};

type TurnDriverSetup = Pick<
  TurnDriverState,
  'harness' | 'runTracker' | 'streamHistory' | 'streamPrompt' | 'workspaceSelectionBox'
>;

export type TurnDriverHandle = {
  run: () => Promise<TurnDriverResult | undefined>;
  getRunTracker: () => AgentRunTracker;

  getLastFacts: () => TurnDriverResultBase;

  getAccumulatedResponse: () => string;
  getBatchCount: () => number;
  hasToolCalls: () => boolean;
};

const MAX_AUTONOMOUS_BATCHES = 50;

const TEXT_COMMIT_INTERVAL_MS = 250;

const runTurnBatches = async (
  state: TurnDriverState,
  deps: TurnDriverDeps,
): Promise<TurnDriverResult | undefined> => {
  const { plan, streamState, uiChunkEmitter } = deps;
  const threadId = plan.threadId;

  const batch = plan.budget.batch;
  const autonomousMode = Boolean(batch && batch.max > 1);
  const previewEnabled = deps.conversationPreview !== false;
  let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let previewText = '';
  let lastPreviewText = '';
  let streamResult: TurnDriverResult | undefined;
  let accumulatedPerf: AgentTurnPerf | undefined;

  const sendConversationPreview = (kind: ConversationPreview['kind'], text: string, toolName?: string) => {
    if (!previewEnabled || !threadId) return;
    getCompanion().setConversationPreview({
      threadId,
      kind,
      text: text.slice(-200),
      ...(toolName ? { toolName } : {}),
    });
  };

  const debouncedTextPreview = (text: string) => {
    lastPreviewText = text;
    if (previewDebounceTimer) return;
    previewDebounceTimer = setTimeout(() => {
      previewDebounceTimer = null;
      sendConversationPreview('responding', lastPreviewText);
    }, 300);
  };

  const textGate = createTextCommitGate({
    threadId,
    runId: () => state.runTracker.id,
    messageId: uiChunkEmitter.messageId,
    publish: text => uiChunkEmitter.emitTextDelta(text),
    previewText: () => previewText,
    intervalMs: TEXT_COMMIT_INTERVAL_MS,
  });
  const flushCommittedText = textGate.flush;
  const bufferStreamedText = textGate.buffer;

  const forwardAgentStep = (step: AgentStep) => {

    if (step.type === 'message_update' && step.kind === 'reasoning') {
      uiChunkEmitter.emitReasoningDelta(step.text);
      return;
    }

    if (step.type === 'message_update') {
      bufferStreamedText(step.text);
      if (step.kind === 'text') {
        previewText = previewText + step.text;
        debouncedTextPreview(previewText);
      }
      return;
    }

    flushCommittedText();

    let event: ChatStreamEvent | null = null;

    if (step.type === 'tool_execution_start') {
      state.turnHadToolCalls = true;
      sendConversationPreview('tool', previewText || ' ', step.toolName);
      event = {
        type: 'tool-call',
        toolCallId: step.toolCallId,
        toolName: step.toolName,
        input: step.input,
      };
    } else if (step.type === 'tool_execution_end') {
      if (step.outcome === 'success') {
        event = {
          type: 'tool-result',
          toolCallId: step.toolCallId,
          output: step.output,
        };
      } else {
        event = {
          type: 'tool-error',
          toolCallId: step.toolCallId,
          error: step.error ?? 'Tool execution failed',
        };
      }
    }

    if (event) {
      state.runTracker.recordAgentStep(step);
      uiChunkEmitter.emitToolEvent(event);
      if (
        event.type === 'tool-call' ||
        event.type === 'tool-result' ||
        event.type === 'tool-error'
      ) {
        deps.onToolActivity?.();
      }
    }
  };

  try {
    sendConversationPreview('thinking', '');

    // eslint-disable-next-line no-constant-condition
    while (true) {

      let agentResult: HarnessTurnResult | undefined;
      let cancelled = false;
      let steered = false;

      try {
        agentResult = await runWithToolRuntimeContext(
              {
                runId: state.runTracker.id,
                runTracker: state.runTracker,
                threadId,
                conversationModel: {
                  providerType: plan.providerType,
                  providerId: plan.providerId,
                  model: plan.model,
                },
                ...(state.workspaceSelectionBox
                  ? { workspaceSelectionBox: state.workspaceSelectionBox }
                  : {}),
                ...(deps.registerChildRunAlias
                  ? { registerChildRunAlias: deps.registerChildRunAlias }
                  : {}),
              },
              async () => {
                for await (const event of state.harness.turn({
                  prompt: state.streamPrompt,
                  history: state.streamHistory,
                  ...(plan.compactionSummary ? { compactionSummary: plan.compactionSummary } : {}),
                  runId: state.runTracker.id,
                  onInference: record => state.runTracker.recordModelStep(record),
                  ...(deps.onCompacted ? { onCompacted: deps.onCompacted } : {}),
                  abortSignal: streamState.abortController.signal,
                })) {
                  if (event.event === 'step') {
                    forwardAgentStep(event.step);
                    continue;
                  }

                  if (event.event === 'done') {
                    const output = event.output;
                    return {
                      response: output.text,
                      toolCalls: output.toolCalls,
                      ...(output.pendingToolCalls && output.pendingToolCalls.length > 0
                        ? { pendingToolCalls: output.pendingToolCalls }
                        : {}),
                      toolApprovalRequests: output.toolApprovalRequests,
                      usage: output.usage,
                      ...(output.lastStepInputTokens != null
                        ? { lastStepInputTokens: output.lastStepInputTokens }
                        : {}),
                      ...(output.perf ? { perf: output.perf } : {}),
                      ...(output.toolSchemaTokens
                        ? { toolSchemaTokens: output.toolSchemaTokens }
                        : {}),
                      iterations: 0,
                      requiresApproval: output.requiresApproval,
                      finishReason: output.finishReason,
                      ...(output.pendingToolCalls
                        ? { pendingToolCalls: output.pendingToolCalls }
                        : {}),
                    } as HarnessTurnResult;
                  }
                }
                return undefined;
              }
            );
      } catch (error) {
        if (
          (streamState.steered ?? false) ||
          streamState.cancelled ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          if ((streamState.steered ?? false) && !streamState.cancelled) {
            steered = true;
          } else {
            cancelled = true;
          }
        } else {
          throw error;
        }
      }

      if (steered) {
        flushCommittedText();
        streamState.steered = false;
        const drained = deps.drainSteerMessages();
        if (drained.length > 0) {
          const steerPrompt =
            drained.length === 1
              ? drained[0]
              : drained.join('\n\n---\n\n');

          const steeringPayload: SteeringInputAcceptedPayload = {
            runId: state.runTracker.id,

            messageId: `steer_${state.runTracker.id}_${state.batchIndex}`,
            batchIndex: state.batchIndex,
            text: steerPrompt,
          };
          recordSessionEvents(threadId, [
            {
              type: STEERING_INPUT_ACCEPTED,
              version: SESSION_EVENT_VERSION,
              payload: steeringPayload as unknown as Record<string, unknown>,
            },
          ]);
          state.streamHistory = [
            ...state.harness.getHistory(),
            { role: 'user' as const, content: `[STEERING INPUT]\n\n${steerPrompt}` },
          ];
        } else {
          state.streamHistory = state.harness.getHistory();
        }
        streamState.abortController = new AbortController();
        state.streamPrompt = '';
        continue;
      }

      if (cancelled) {
        streamResult = { outcome: 'cancelled' };
        break;
      }

      if (agentResult?.perf) {
        accumulatedPerf = addTurnPerf(accumulatedPerf, agentResult.perf);
      }

      const resultBase: TurnDriverResultBase = {
        ...(agentResult?.response?.trim()
          ? { response: agentResult.response }
          : {}),
        usage: agentResult?.usage,
        ...(agentResult?.lastStepInputTokens != null
          ? { lastStepInputTokens: agentResult.lastStepInputTokens }
          : {}),
        perf: accumulatedPerf,
        ...(agentResult?.toolSchemaTokens
          ? { toolSchemaTokens: agentResult.toolSchemaTokens }
          : {}),
      };
      streamResult = {
        ...resultBase,
        outcome: agentResult?.finishReason === 'tool-calls' ? 'budget-exhausted' : 'completed',
      };

      if (streamResult.response) {
        state.accumulatedResponse = state.accumulatedResponse
          ? state.accumulatedResponse + '\n\n' + streamResult.response
          : streamResult.response;
      }

      if (state.accumulatedResponse) {
        sendConversationPreview('responding', state.accumulatedResponse);
      }
      previewText = '';

      if (
        streamResult.outcome === 'cancelled' ||
        streamResult.outcome === 'partial-failure' ||
        streamResult.outcome === 'completed'
      ) break;


      state.lastFacts = {
        ...(streamResult.usage ? { usage: streamResult.usage } : {}),
      };

      if (!autonomousMode || streamResult.outcome !== 'budget-exhausted') break;

      state.batchIndex++;
      if (state.batchIndex >= Math.min(MAX_AUTONOMOUS_BATCHES, batch?.max ?? MAX_AUTONOMOUS_BATCHES)) {

        break;
      }

      state.streamHistory = state.harness.getHistory();
      state.streamPrompt = batch?.continuePrompt || 'Continue with the next step.';
    }

    return streamResult;
  } finally {

    if (previewDebounceTimer) {
      clearTimeout(previewDebounceTimer);
      previewDebounceTimer = null;
    }
    flushCommittedText();
  }
};

export const createTurnDriver = (
  setup: TurnDriverSetup,
  deps: TurnDriverDeps
): TurnDriverHandle => {
  const state: TurnDriverState = {
    ...setup,
    accumulatedResponse: '',
    batchIndex: 0,
    turnHadToolCalls: false,
    lastFacts: {},
  };
  return {
    run: () => runTurnBatches(state, deps),
    getRunTracker: () => state.runTracker,
    getLastFacts: () => state.lastFacts,
    getAccumulatedResponse: () => state.accumulatedResponse,
    getBatchCount: () => state.batchIndex,
    hasToolCalls: () => state.turnHadToolCalls,
  };
};
