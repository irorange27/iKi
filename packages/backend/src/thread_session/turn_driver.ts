import type { ModelMessage } from '../message/model_history';

import { addTurnPerf, type AgentStep, type AgentTurnPerf } from '@iki/backend/agent';
import type { ConversationPreview } from '@iki/backend/types/companion';
import { runWithToolRuntimeContext } from '../utils/runtime_context';
import type { TurnDriverHarness, TurnOutput } from '../agent/harness';
import type { AgentRunTracker } from './run_tracker';
import type { ApprovalRecoveryContext, RegisterApprovalBatch } from './approval_types';
import type { ExecutionPlan } from './execution_plan';
import {
  recordSessionEvents,
  STEERING_INPUT_ACCEPTED,
  SESSION_EVENT_VERSION,
  type SteeringInputAcceptedPayload,
} from './session_log';
import { recordInlineToolExecution } from './tool_execution';
import { createTextCommitGate } from './text_commit_gate';
import { getCompanion } from './platform';
import type { ActiveStreamState, ChatStreamEvent, ChatStreamTarget, UiChunkEmitter } from './types';

type TurnDriverResultBase = {
  response?: string;
  usage?: import('@iki/backend/agent').AgentResult['usage'];

  lastStepInputTokens?: number;

  perf?: AgentTurnPerf;

  toolSchemaTokens?: { builtin: number; mcp: number };

  pendingToolCalls?: import('../agent/runners/pi_agent_loop').PiLoopToolCall[];
};

type HarnessTurnResult = import('@iki/backend/agent').AgentResult & {
  pendingToolCalls?: TurnOutput['pendingToolCalls'];
};

export type TurnDriverResult =
  | (TurnDriverResultBase & { outcome: 'completed' })
  | (TurnDriverResultBase & { outcome: 'budget-exhausted' })
  | (TurnDriverResultBase & { outcome: 'awaiting-approval' })
  | (TurnDriverResultBase & { outcome: 'cancelled' })
  | (TurnDriverResultBase & { outcome: 'partial-failure' });

type TurnDriverState = {

  harness: TurnDriverHarness;
  runTracker: AgentRunTracker;
  approvalContext?: ApprovalRecoveryContext;
  streamHistory: ModelMessage[];
  streamPrompt: string;

  workspaceSelectionBox?: { selection: unknown };
  accumulatedResponse: string;
  batchIndex: number;
  turnHadToolCalls: boolean;
  isAwaitingApproval: boolean;

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

  registerChildRunAlias?: (parentRunId: string, childRunId: string) => () => void;
  approvals: {
    ensurePendingApprovalSession: (
      approvalId: string,
      session: {
        target: ChatStreamTarget;
        history?: ModelMessage[];
        recoveryContext?: ApprovalRecoveryContext;
      }
    ) => unknown;
    registerApprovalBatch: RegisterApprovalBatch;
  };
};

export type TurnDriverSetup = Pick<
  TurnDriverState,
  'harness' | 'runTracker' | 'approvalContext' | 'streamHistory' | 'streamPrompt' | 'workspaceSelectionBox'
>;

export type TurnDriverHandle = {
  run: () => Promise<TurnDriverResult | undefined>;
  getRunTracker: () => AgentRunTracker;

  getLastFacts: () => TurnDriverResultBase;

  getAccumulatedResponse: () => string;
  getBatchCount: () => number;
  hasToolCalls: () => boolean;
  isAwaitingApproval: () => boolean;
};

const MAX_AUTONOMOUS_BATCHES = 50;

const TEXT_COMMIT_INTERVAL_MS = 250;

const runTurnBatches = async (
  state: TurnDriverState,
  deps: TurnDriverDeps,
): Promise<TurnDriverResult | undefined> => {
  const { target, plan, streamState, uiChunkEmitter } = deps;
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
    } else if (step.type === 'approval_request') {
      for (const req of step.requests) {
        if (req.approvalId) {
          deps.approvals.ensurePendingApprovalSession(req.approvalId, {
            target,
            history: state.harness.getHistory(),
            recoveryContext: state.approvalContext,
          });
        }
      }
      for (const req of step.requests) {
        if (req.approvalId) {
          uiChunkEmitter.emitToolEvent({
            type: 'tool-approval-request',
            approvalId: req.approvalId,
            toolCallId: req.toolCallId || '',
            ...(req.toolCall
              ? {
                  toolCall: {
                    toolName: req.toolCall.toolName,
                    toolCallId: req.toolCallId || '',
                    args: req.toolCall.args ?? {},
                  },
                }
              : {}),
          });
        }
      }
      return;
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
                  runId: state.runTracker.id,
                  recordInlineExecution: ({ runId, toolCallId, toolName, args, output }) =>
                    recordInlineToolExecution({
                      threadId,
                      runId,
                      toolCallId,
                      toolName,
                      args,
                      output,
                    }),
                  onInference: record => state.runTracker.recordModelStep(record),
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

      if (agentResult?.requiresApproval && agentResult.toolApprovalRequests?.length) {
        deps.approvals.registerApprovalBatch(agentResult.toolApprovalRequests, {
          target,
          history: state.harness.getHistory(),
          ...(state.approvalContext ? { recoveryContext: state.approvalContext } : {}),
        });
        state.runTracker.recordAgentStep({
          type: 'approval_request',
          requests: agentResult.toolApprovalRequests,
        });
        streamResult = {
          outcome: 'awaiting-approval',
          response: agentResult.response,
          usage: agentResult.usage,
          ...(agentResult.lastStepInputTokens != null
            ? { lastStepInputTokens: agentResult.lastStepInputTokens }
            : {}),
          perf: accumulatedPerf,
          ...(agentResult.toolSchemaTokens
            ? { toolSchemaTokens: agentResult.toolSchemaTokens }
            : {}),
        };
        state.isAwaitingApproval = true;
        state.lastFacts = {
          ...(agentResult.usage ? { usage: agentResult.usage } : {}),
        };
        break;
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
        ...(agentResult?.pendingToolCalls && agentResult.pendingToolCalls.length > 0
          ? { pendingToolCalls: agentResult.pendingToolCalls }
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
        streamResult.outcome === 'awaiting-approval' ||
        streamResult.outcome === 'partial-failure' ||
        streamResult.outcome === 'completed'
      ) break;


      state.lastFacts = {
        ...(streamResult.usage ? { usage: streamResult.usage } : {}),
        ...(streamResult.pendingToolCalls && streamResult.pendingToolCalls.length > 0
          ? { pendingToolCalls: streamResult.pendingToolCalls }
          : {}),
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
    isAwaitingApproval: false,
    lastFacts: {},
  };
  return {
    run: () => runTurnBatches(state, deps),
    getRunTracker: () => state.runTracker,
    getLastFacts: () => state.lastFacts,
    getAccumulatedResponse: () => state.accumulatedResponse,
    getBatchCount: () => state.batchIndex,
    hasToolCalls: () => state.turnHadToolCalls,
    isAwaitingApproval: () => state.isAwaitingApproval,
  };
};
