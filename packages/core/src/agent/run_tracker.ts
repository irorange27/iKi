import {
  appendAgentRunStep,
  createAgentRun,
  createAgentRunCheckpoint,
  getAgentRun,
  updateAgentRun,
} from '../db/agent_runs';
import type {
  AgentRun,
  AgentRunCheckpointReason,
  AgentRunError,
  AgentRunInput,
  AgentRunKind,
  AgentRunOutput,
  AgentRunStep,
  AgentRunStepType,
  AgentRunWorkingState,
} from '../types/agent_run';
import { createPrefixedId } from '../utils/id';
import {
  normalizeWhitespace,
  sanitizePromptMetadataText,
  toIsoNow,
} from '../utils/text';
import type { AgentResult } from './types';
import type { ConversationRunnerStreamEvent } from './types';

type CreateAgentRunTrackerParams = {
  kind: AgentRunKind;
  threadId?: string;
  parentRunId?: string;
  rootRunId?: string;
  providerType: string;
  providerId?: string;
  model: string;
  systemPrompt: string;
  enabledTools: string[];
  availableSkillIds: string[];
  input: AgentRunInput;
  working: AgentRunWorkingState;
};

type FinalizeRunParams = {
  text?: string;
  finishReason?: string;
  usage?: Record<string, unknown>;
};

type BlockRunParams = FinalizeRunParams & {
  pendingApprovalIds?: string[];
};

type FailRunParams = AgentRunError;

const getNestedToolEventField = (
  event: ConversationRunnerStreamEvent,
  field: 'toolCallId' | 'toolName'
): unknown => {
  if (field in event) return event[field];
  const nestedToolCall = event.toolCall;
  if (!nestedToolCall || typeof nestedToolCall !== 'object') return undefined;
  return (nestedToolCall as Record<string, unknown>)[field];
};

const getToolNameFromEvent = (event: ConversationRunnerStreamEvent): string =>
  sanitizePromptMetadataText(getNestedToolEventField(event, 'toolName'), { maxChars: 80 }) ||
  'tool';

const getToolCallIdFromEvent = (event: ConversationRunnerStreamEvent): string =>
  sanitizePromptMetadataText(getNestedToolEventField(event, 'toolCallId'), { maxChars: 120 }) ||
  sanitizePromptMetadataText(event.id, { maxChars: 120 }) ||
  createPrefixedId('tool_call');

const toSummary = (value: string, fallback: string): string =>
  sanitizePromptMetadataText(value, { maxChars: 160 }) || fallback;

const buildOutput = (params: FinalizeRunParams): AgentRunOutput | null => {
  const output: AgentRunOutput = {
    ...(typeof params.text === 'string' ? { text: params.text } : {}),
    ...(typeof params.finishReason === 'string' ? { finishReason: params.finishReason } : {}),
    ...(params.usage && typeof params.usage === 'object' ? { usage: params.usage } : {}),
  };
  return Object.keys(output).length > 0 ? output : null;
};

const inferRootRunId = (parentRunId?: string, explicitRootRunId?: string): string | null => {
  const normalizedRootRunId = normalizeWhitespace(explicitRootRunId);
  if (normalizedRootRunId) return normalizedRootRunId;

  const normalizedParentRunId = normalizeWhitespace(parentRunId);
  if (!normalizedParentRunId) return null;

  return getAgentRun(normalizedParentRunId)?.rootRunId ?? normalizedParentRunId;
};

export type AgentRunTracker = {
  id: string;
  getRun: () => AgentRun;
  syncModelMessages: (messages: unknown[]) => AgentRun;
  createCheckpoint: (reason: AgentRunCheckpointReason) => void;
  recordToolEvent: (event: ConversationRunnerStreamEvent) => void;
  recordChildRun: (params: {
    childRunId: string;
    childKind: AgentRunKind;
    summary?: string;
    input?: Record<string, unknown> | null;
    output?: Record<string, unknown> | null;
  }) => AgentRun;
  recordToolCalls: (toolCalls?: AgentResult['toolCalls']) => AgentRun;
  markCompleted: (params: FinalizeRunParams) => AgentRun;
  markBlocked: (params: BlockRunParams) => AgentRun;
  markFailed: (params: FailRunParams) => AgentRun;
  markCancelled: (params?: Pick<FinalizeRunParams, 'text'>) => AgentRun;
};

export const createAgentRunTracker = (
  params: CreateAgentRunTrackerParams
): AgentRunTracker => {
  const runId = createPrefixedId('run');
  const normalizedParentRunId = normalizeWhitespace(params.parentRunId) || null;
  const resolvedRootRunId =
    inferRootRunId(normalizedParentRunId ?? undefined, params.rootRunId) || runId;

  let currentRun = createAgentRun({
    id: runId,
    kind: params.kind,
    status: 'running',
    threadId: normalizeWhitespace(params.threadId) || null,
    parentRunId: normalizedParentRunId,
    rootRunId: resolvedRootRunId,
    providerType: params.providerType,
    providerId: normalizeWhitespace(params.providerId) || null,
    model: params.model,
    systemPrompt: params.systemPrompt,
    enabledTools: params.enabledTools,
    availableSkillIds: params.availableSkillIds,
    input: params.input,
    working: params.working,
    output: null,
    error: null,
  });

  const persist = (updates: Partial<Omit<AgentRun, 'id' | 'createdAt' | 'updatedAt'>>) => {
    const updated = updateAgentRun(currentRun.id, updates);
    if (updated) {
      currentRun = updated;
    } else {
      currentRun = {
        ...currentRun,
        ...updates,
        updatedAt: toIsoNow(),
      };
    }
  };

  const createCheckpoint = (reason: AgentRunCheckpointReason) => {
    createAgentRunCheckpoint({
      id: createPrefixedId('checkpoint'),
      runId: currentRun.id,
      stepIndex: currentRun.working.lastStepIndex,
      reason,
      snapshot: currentRun,
    });
  };

  const appendStep = (params: {
    type: AgentRunStepType;
    status: AgentRunStep['status'];
    summary: string;
    input?: Record<string, unknown> | null;
    output?: Record<string, unknown> | null;
  }): AgentRunStep => {
    const startedAt = toIsoNow();
    const stepIndex = currentRun.working.lastStepIndex + 1;
    const step: AgentRunStep = {
      id: createPrefixedId('step'),
      runId: currentRun.id,
      stepIndex,
      type: params.type,
      status: params.status,
      summary: params.summary,
      input: params.input ?? null,
      output: params.output ?? null,
      startedAt,
      finishedAt: startedAt,
    };
    appendAgentRunStep(step);
    persist({
      working: {
        ...currentRun.working,
        lastStepIndex: stepIndex,
      },
    });
    return step;
  };

  return {
    id: currentRun.id,
    getRun: () => currentRun,
    syncModelMessages: messages => {
      persist({
        working: {
          ...currentRun.working,
          modelMessages: Array.isArray(messages) ? structuredClone(messages) : [],
        },
      });
      return currentRun;
    },
    createCheckpoint: reason => {
      createCheckpoint(reason);
    },
    recordToolEvent: event => {
      if (!event || typeof event !== 'object' || typeof event.type !== 'string') return;

      if (event.type === 'tool-call') {
        appendStep({
          type: 'tool-call',
          status: event.invalid ? 'failed' : 'completed',
          summary: toSummary(`Tool call ${getToolNameFromEvent(event)}`, 'Tool call'),
          input: {
            toolCallId: getToolCallIdFromEvent(event),
            toolName: getToolNameFromEvent(event),
            ...(event.input && typeof event.input === 'object' ? { input: event.input } : {}),
            ...(event.invalid === true ? { invalid: true } : {}),
          },
          output: event.invalid
            ? {
                error:
                  typeof event.error === 'string'
                    ? event.error
                    : event.error instanceof Error
                      ? event.error.message
                      : 'Invalid tool call',
              }
            : null,
        });
        return;
      }

      if (event.type === 'tool-result') {
        appendStep({
          type: 'tool-result',
          status: 'completed',
          summary: toSummary(`Tool result ${getToolNameFromEvent(event)}`, 'Tool result'),
          input: {
            toolCallId: getToolCallIdFromEvent(event),
            toolName: getToolNameFromEvent(event),
          },
          output:
            event.output && typeof event.output === 'object'
              ? { output: event.output }
              : { output: event.output ?? null },
        });
        return;
      }

      if (event.type === 'tool-error' || event.type === 'tool-output-denied') {
        appendStep({
          type: 'error',
          status: 'failed',
          summary: toSummary(`Tool error ${getToolNameFromEvent(event)}`, 'Tool error'),
          input: {
            toolCallId: getToolCallIdFromEvent(event),
            toolName: getToolNameFromEvent(event),
          },
          output: {
            error:
              typeof event.error === 'string'
                ? event.error
                : event.error instanceof Error
                  ? event.error.message
                  : event.type === 'tool-output-denied'
                    ? 'Tool output denied'
                    : 'Tool execution failed',
          },
        });
        return;
      }

      if (event.type === 'tool-approval-request') {
        const approvalId = normalizeWhitespace(event.approvalId) || createPrefixedId('approval');
        const pendingApprovalIds = Array.from(
          new Set([...currentRun.working.pendingApprovalIds, approvalId])
        );

        appendStep({
          type: 'approval-request',
          status: 'completed',
          summary: toSummary(
            `Approval requested for ${getToolNameFromEvent(event)}`,
            'Approval requested'
          ),
          input: {
            approvalId,
            toolCallId: getToolCallIdFromEvent(event),
            toolName: getToolNameFromEvent(event),
          },
        });

        persist({
          status: 'blocked',
          working: {
            ...currentRun.working,
            pendingApprovalIds,
          },
        });
        createCheckpoint('approval-requested');
      }
    },
    recordChildRun: params => {
      appendStep({
        type: 'child-run',
        status: 'completed',
        summary: toSummary(
          params.summary || `Spawned ${params.childKind} run ${params.childRunId}`,
          'Child run spawned'
        ),
        input: {
          childRunId: params.childRunId,
          childKind: params.childKind,
          ...(params.input ?? {}),
        },
        output: params.output ?? null,
      });
      createCheckpoint('child-run-spawned');
      return currentRun;
    },
    recordToolCalls: toolCalls => {
      for (const toolCall of toolCalls ?? []) {
        const toolName =
          typeof toolCall?.toolName === 'string' && toolCall.toolName.trim()
            ? toolCall.toolName.trim()
            : 'tool';
        appendStep({
          type: 'tool-call',
          status: 'completed',
          summary: toSummary(`Tool call ${toolName}`, 'Tool call'),
          input: {
            toolName,
            ...(toolCall?.args && typeof toolCall.args === 'object' ? { args: toolCall.args } : {}),
          },
        });
      }
      return currentRun;
    },
    markCompleted: params => {
      appendStep({
        type: 'model',
        status: 'completed',
        summary: toSummary('Run completed successfully', 'Run completed'),
        output: {
          ...(typeof params.text === 'string' ? { text: params.text } : {}),
          ...(typeof params.finishReason === 'string'
            ? { finishReason: params.finishReason }
            : {}),
          ...(params.usage && typeof params.usage === 'object' ? { usage: params.usage } : {}),
        },
      });

      persist({
        status: 'completed',
        working: {
          ...currentRun.working,
          accumulatedText: typeof params.text === 'string' ? params.text : '',
          pendingApprovalIds: [],
        },
        output: buildOutput({
          ...params,
          finishReason: params.finishReason || 'completed',
        }),
        error: null,
      });
      createCheckpoint('run-completed');
      return currentRun;
    },
    markBlocked: params => {
      const pendingApprovalIds = Array.from(
        new Set([
          ...currentRun.working.pendingApprovalIds,
          ...((params.pendingApprovalIds ?? []).map(id => normalizeWhitespace(id)).filter(Boolean) as string[]),
        ])
      );

      if (pendingApprovalIds.length > 0 && currentRun.working.pendingApprovalIds.length === 0) {
        appendStep({
          type: 'approval-request',
          status: 'completed',
          summary: toSummary('Approval requested', 'Approval requested'),
          output: {
            pendingApprovalIds,
          },
        });
      }

      persist({
        status: 'blocked',
        working: {
          ...currentRun.working,
          accumulatedText: typeof params.text === 'string' ? params.text : '',
          pendingApprovalIds,
        },
        output: buildOutput({
          ...params,
          finishReason: params.finishReason || 'approval-requested',
        }),
        error: null,
      });
      createCheckpoint('approval-requested');
      return currentRun;
    },
    markFailed: params => {
      appendStep({
        type: 'error',
        status: 'failed',
        summary: toSummary(params.message, 'Run failed'),
        output: {
          message: params.message,
          ...(typeof params.code === 'string' ? { code: params.code } : {}),
          ...(typeof params.retryable === 'boolean' ? { retryable: params.retryable } : {}),
        },
      });

      persist({
        status: 'failed',
        error: params,
      });
      createCheckpoint('run-failed');
      return currentRun;
    },
    markCancelled: params => {
      appendStep({
        type: 'finalize',
        status: 'completed',
        summary: toSummary('Run cancelled', 'Run cancelled'),
        output: typeof params?.text === 'string' ? { text: params.text } : null,
      });

      persist({
        status: 'cancelled',
        working: {
          ...currentRun.working,
          accumulatedText: typeof params?.text === 'string' ? params.text : '',
        },
        output: buildOutput({
          text: params?.text,
          finishReason: 'cancelled',
        }),
      });
      createCheckpoint('run-cancelled');
      return currentRun;
    },
  };
};
