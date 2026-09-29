import type {
  ChatUiMessage,
  SkillUsageEntry,
  TokenUsagePartData,
} from '@iki/backend/message/message_parts';
import type { ModelMessage } from 'ai';
import type { AffectSignal } from '@iki/backend/types/affect';

export type ChatStreamTarget = {
  id: number;
  send: (channel: string, ...args: unknown[]) => void;
};

export type ChatInputMessage = ModelMessage;
export type ChatTransportMessage = ChatInputMessage | ChatUiMessage;

export type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
  finish: () => void;
  abort: () => void;
  error: (errorText: string) => void;
};
