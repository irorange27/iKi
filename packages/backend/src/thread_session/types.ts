import type {
  SkillUsageEntry,
  TokenUsagePartData,
} from '@iki/backend/message/message_parts';
import type { AffectSignal } from '@iki/backend/types/affect';

// The message-type aliases live with the message codecs (message/); this
// module keeps the turn transport's own types.
export type {
  ChatInputMessage,
  ChatTransportMessage,
  LlmChatMessage,
} from '@iki/backend/message/chat_message_types';

export type ChatStreamTarget = {
  id: number;
  send: (channel: string, ...args: unknown[]) => void;
};

export type ActiveStreamState = {
  cancelled: boolean;
  stoppedByUser: boolean;
  abortController: AbortController;
  runId?: string;
  steered?: boolean;
};

export type ChatStreamEvent =
  | { type: 'tool-input-start'; toolCallId: string; toolName: string }
  | { type: 'tool-input-delta'; toolCallId: string; delta: string }
  | { type: 'tool-input-end'; toolCallId: string }
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      input?: Record<string, unknown>;
      invalid?: boolean;
      error?: unknown;
    }
  | {
      type: 'tool-result';
      toolCallId: string;
      toolName?: string;
      output?: unknown;
      preliminary?: boolean;
    }
  | { type: 'tool-error'; toolCallId: string; toolName?: string; error?: unknown }
  | { type: 'tool-output-denied'; toolCallId: string; toolName?: string; error?: unknown }
  | {
      type: 'tool-approval-request';
      approvalId: string;
      toolCallId?: string;
      toolName?: string;
      toolCall?: {
        toolName?: string;
        toolCallId?: string;
        args?: Record<string, unknown>;
        input?: Record<string, unknown>;
      };
    };

export type RunStatusEvent = {
  runId: string;
  status: import('@iki/backend/types/agent_run').AgentRunStatus;
  threadId?: string | null;
  timestamp: string;
};

/** The durable assistant-message projection built from a turn's UI chunk log. */
export type PersistedTurnMessage = {
  id: string;
  role: 'assistant';
  parts: unknown[];
};

export type UiChunkEmitter = {
  messageId: string;
  emitTextDelta: (delta: string) => void;
  emitReasoningDelta: (delta: string) => void;
  emitToolEvent: (event: ChatStreamEvent) => void;
  emitSkillUsage: (payload: {
    mode?: 'manual' | 'auto';
    skills: SkillUsageEntry[];
  }) => void;
  emitMemoryRetrieval: (payload: {
    query: string;
    results: Array<Record<string, unknown>>;
  }) => void;
  emitAffectSignal: (payload: AffectSignal) => void;
  emitTokenUsage: (payload: TokenUsagePartData) => void;
  /**
   * Reduce the turn's chunk log into the durable assistant message. `seedParts`
   * continues an approval-resumed message: the pre-pause parts are the
   * reduction starting point, matching how the renderer's AI SDK client keeps
   * one accumulated message across the resume. Returns null when the turn
   * never started a message.
   */
  buildPersistedMessage: (
    seedParts?: unknown[]
  ) => Promise<PersistedTurnMessage | null>;
  /**
   * Close the open text/reasoning parts without terminating the channel —
   * the durable projection needs closed parts while the session-log record
   * and persist that follow still need a live error channel.
   */
  settleParts: () => void;
  finish: () => void;
  abort: () => void;
  error: (errorText: string) => void;
};
