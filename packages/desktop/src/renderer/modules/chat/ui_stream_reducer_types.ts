import type {
  ChatUiMessage,
  ChatUiMessageChunk,
  TokenUsagePartData,
} from '@iki/backend/chat/message_parts';
import type { ToolUiState, ToolUiStatePatch } from './tool_ui_state';

export type StreamState = {
  activeAssistantMessageId: string | null;
  activeAssistantParentId: string | null;
  activeStreamThreadId: string | null;
  streamingAssistantText: string;
  streamRenderTick: number;
};

export const createInitialStreamState = (): StreamState => ({
  activeAssistantMessageId: null,
  activeAssistantParentId: null,
  activeStreamThreadId: null,
  streamingAssistantText: '',
  streamRenderTick: 0,
});

export type StreamContext = {
  messages: ChatUiMessage[];
  createMessageId: () => string;
  currentThreadId: string | null;
  nowMs: number;
  toolUiStateMap: Readonly<Record<string, ToolUiState>>;
};

export type MessageOp =
  | { type: 'append'; message: ChatUiMessage }
  | { type: 'replace'; messageId: string; message: ChatUiMessage }
  | { type: 'remove'; messageId: string };

export type StreamEffect =
  | { type: 'scroll' }
  | {
      type: 'persist';
      message: ChatUiMessage;
      threadId: string;
      parentId?: string;
      source: string;
    }
  | { type: 'notify_persisted'; threadId: string; shouldNotify: boolean }
  | { type: 'tool_ui_state'; toolCallId: string; patch: ToolUiStatePatch }
  | {
      type: 'approval_request';
      payload: {
        approvalId: string;
        toolCallId: string;
        toolCall: { toolName: string; toolCallId: string; args: unknown };
      };
    }
  | { type: 'reset_approvals' };

export type ToolUiChunk = Extract<
  ChatUiMessageChunk,
  {
    type:
      | 'tool-input-start'
      | 'tool-input-delta'
      | 'tool-input-available'
      | 'tool-input-error'
      | 'tool-output-available'
      | 'tool-output-error'
      | 'tool-output-denied'
      | 'tool-approval-request';
  }
>;

export type StatefulToolUiChunk = Exclude<ToolUiChunk, { type: 'tool-approval-request' }>;

export type StreamAction =
  | { type: 'begin_turn'; threadId: string; parentId: string }
  | { type: 'reset' }
  | { type: 'text_delta'; delta: string }
  | { type: 'finalize_response'; fullText: string }
  | { type: 'tool_chunk'; chunk: ToolUiChunk }
  | {
      type: 'skill_chunk';
      chunk: { mode?: unknown; skills?: unknown };
    }
  | { type: 'memory_chunk'; chunk: { query?: unknown; results?: unknown } }
  | {
      type: 'affect_chunk';
      chunk: {
        source?: unknown;
        guardActive?: unknown;
        label?: unknown;
        confidence?: unknown;
        valence?: unknown;
        arousal?: unknown;
        emotions?: unknown;
        sampleCount?: unknown;
        windowSize?: unknown;
        startAt?: unknown;
        endAt?: unknown;
        ageMinutes?: unknown;
        windowMinutes?: unknown;
      };
    }
  | {
      type: 'usage_chunk';
      chunk: TokenUsagePartData;
    };

export type ReduceResult = {
  state: StreamState;
  messageOps: MessageOp[];
  effects: StreamEffect[];
};
