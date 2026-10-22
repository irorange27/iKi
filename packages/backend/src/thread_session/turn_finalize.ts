import type { TurnDriverResult } from './turn_driver';
import type { AgentRunTracker } from './run_tracker';
import {
  recordFailureTerminalEvent,
  recordSessionEvents,
  SessionLogCommitError,
  SessionLogWriteError,
  turnFactsToEvents,
} from './session_log';
import type { TurnOutput } from '../agent/harness';
import type { AgentRunStatus } from '@iki/backend/types/agent_run';

export const runFailureFromError = (error: unknown, message: string) => ({
  message,
  ...(error instanceof SessionLogCommitError
    ? {
        code: 'SESSION_LOG_COMMIT_FAILED',
        retryable: false,
        ...(error.generatedText ? { text: error.generatedText } : {}),
      }
    : error instanceof SessionLogWriteError
      ? { code: 'SESSION_LOG_WRITE_FAILED', retryable: false }
      : {}),
});

type TurnOutcomeSpec = {

  runStatus: AgentRunStatus;

  finishReason?: string;

  errorText?: string;
  retryable?: boolean;

  terminal?: { eventKind: 'completed' | 'failed' | 'cancelled'; status: AgentRunStatus };

  text?: (text: string) => string | undefined;
};

const asOptionalText = (text: string): string | undefined => (text ? text : undefined);

const TURN_OUTCOMES: Record<TurnDriverResult['outcome'], TurnOutcomeSpec> = {
  completed: {
    runStatus: 'completed',
    finishReason: 'completed',
    terminal: { eventKind: 'completed', status: 'completed' },
    text: asOptionalText,
  },
  'budget-exhausted': {

    runStatus: 'completed',
    finishReason: 'budget-exhausted',
    terminal: { eventKind: 'completed', status: 'completed' },
    text: asOptionalText,
  },
  'awaiting-approval': {

    runStatus: 'blocked',
    finishReason: 'approval-requested',
    text: asOptionalText,
  },
  cancelled: {
    runStatus: 'cancelled',
    finishReason: 'cancelled',
    terminal: { eventKind: 'cancelled', status: 'cancelled' },
    text: asOptionalText,
  },
  'partial-failure': {
    runStatus: 'failed',
    finishReason: 'partial-failure',
    errorText: 'Autonomous iteration failed; partial progress saved.',
    retryable: true,
    terminal: {
      eventKind: 'failed',
      status: 'failed',
    },
  },
};

export type TurnFailureSpec = {
  status: 'failed';
  errorText: string;
  code?: string;
  retryable?: boolean;
};

export type TerminalRunTracker = Pick<
  AgentRunTracker,
  'id' | 'getRun' | 'markCompleted' | 'markBlocked' | 'markFailed' | 'markCancelled'
>;

export type FinalizeTurnParams = {
  tracker: TerminalRunTracker;
  outcome: TurnDriverResult['outcome'];

  text?: string;
  usage?: import('@iki/backend/agent').AgentResult['usage'];


  pendingToolCalls?: TurnOutput['pendingToolCalls'];

  threadId?: string;

  transport: string;

  onlyIfRunning?: boolean;

  skipRow?: boolean;

  loudGuard?: boolean;

  committed?: {
    messageId: string;
    message: never;
  };
  notify?: () => void;
};

const projectTurnOutcome = (
  outcome: TurnDriverResult['outcome'],
  text: string,
): {
  spec: TurnOutcomeSpec;
  text: string | undefined;
  terminalFact?: {
    status: AgentRunStatus;
    finishReason?: string;
    errorText?: string;
  };
  eventKind?: 'completed' | 'failed' | 'cancelled';
} => {
  const spec = TURN_OUTCOMES[outcome];
  const projected = spec.text?.(text);
  const terminalFact = spec.terminal
    ? {
        status: spec.terminal.status,
        ...(spec.finishReason ? { finishReason: spec.finishReason } : {}),
        ...(spec.errorText ? { errorText: spec.errorText } : {}),
      }
    : undefined;
  return { spec, text: projected, ...(terminalFact ? { terminalFact } : {}), eventKind: spec.terminal?.eventKind };
};

export const finalizeTurn = (params: FinalizeTurnParams): void => {
  const { tracker, outcome, transport } = params;
  const projection = projectTurnOutcome(outcome, params.text ?? '');
  const { spec } = projection;
  const status = tracker.getRun().status;
  const writable = !params.skipRow && (!params.onlyIfRunning || status === 'running');

  if (params.threadId && projection.terminalFact && projection.eventKind) {
    const record = params.loudGuard ? recordFailureTerminalEvent : recordSessionEvents;
    record(
      params.threadId,
      turnFactsToEvents({
        ...(params.committed
          ? {
              committed: {
                runId: tracker.id,
                messageId: params.committed.messageId,
                message: params.committed.message,
                transport,
              },
            }
          : {}),
        terminal: { runId: tracker.id, ...projection.terminalFact },
      })
    );
  }

  if (writable) {
    if (spec.runStatus === 'completed') {
      tracker.markCompleted({
        ...(projection.text ? { text: projection.text } : {}),
        ...(params.usage ? { usage: { ...params.usage } } : {}),
        ...(spec.finishReason ? { finishReason: spec.finishReason } : {}),
        ...(params.pendingToolCalls && params.pendingToolCalls.length > 0
          ? { pendingToolCalls: params.pendingToolCalls }
          : {}),
      });
    } else if (spec.runStatus === 'blocked') {
      tracker.markBlocked({
        ...(projection.text ? { text: projection.text } : {}),
        ...(params.usage ? { usage: { ...params.usage } } : {}),
        ...(spec.finishReason ? { finishReason: spec.finishReason } : {}),
      });
    } else if (spec.runStatus === 'cancelled') {
      tracker.markCancelled({ ...(projection.text ? { text: projection.text } : {}) });
    } else {
      tracker.markFailed({
        message: spec.errorText ?? 'Turn failed.',
        ...(spec.retryable !== undefined ? { retryable: spec.retryable } : {}),
      });
    }
  }

  params.notify?.();
};

export const finalizeTurnFailure = (
  params: Omit<FinalizeTurnParams, 'outcome'> & { failure: TurnFailureSpec }
): void => {
  const { tracker, failure, transport } = params;
  if (!params.skipRow) {
    tracker.markFailed({
      message: failure.errorText,
      ...(failure.code ? { code: failure.code } : {}),
      ...(failure.retryable !== undefined ? { retryable: failure.retryable } : {}),

      ...(typeof params.text === 'string' && params.text.length > 0
        ? { text: params.text }
        : {}),
    });
  }
  if (params.threadId) {
    const record = params.loudGuard ? recordFailureTerminalEvent : recordSessionEvents;
    record(
      params.threadId,
      turnFactsToEvents({
        ...(params.committed
          ? {
              committed: {
                runId: tracker.id,
                messageId: params.committed.messageId,
                message: params.committed.message,
                transport,
              },
            }
          : {}),
        terminal: {
          runId: tracker.id,
          status: failure.status,
          errorText: failure.errorText,
        },
      })
    );
  }
  params.notify?.();
};

export const finalizeHarnessTurn = (params: {
  tracker: TerminalRunTracker;
  output: { text: string; usage?: import('@iki/backend/agent').AgentResult['usage']; finishReason?: string };
  transport: string;
}): void => {
  const outcome: TurnDriverResult['outcome'] =
    params.output.finishReason === 'tool-calls' ? 'budget-exhausted' : 'completed';
  finalizeTurn({
    tracker: params.tracker,
    outcome,
    text: params.output.text,
    ...(params.output.usage ? { usage: params.output.usage } : {}),
    transport: params.transport,
  });
};

export const finalizeTurnCancelled = (
  params: Omit<FinalizeTurnParams, 'outcome'> & { keepRowStatus?: AgentRunStatus }
): void => {
  const { tracker, transport } = params;
  if (!params.skipRow && !params.keepRowStatus) {
    tracker.markCancelled({ ...(params.text ? { text: params.text } : {}) });
  }
  if (params.threadId) {
    const record = params.loudGuard ? recordFailureTerminalEvent : recordSessionEvents;
    record(
      params.threadId,
      turnFactsToEvents({
        ...(params.committed
          ? {
              committed: {
                runId: tracker.id,
                messageId: params.committed.messageId,
                message: params.committed.message,
                transport,
              },
            }
          : {}),
        terminal: { runId: tracker.id, status: 'cancelled' },
      })
    );
  }
  params.notify?.();
};
