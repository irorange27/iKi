import type { ConversationRunnerStreamEvent } from '@iki/core/agent';
import type {
  ChatUiMessage,
  SkillUsageEntry,
  TokenUsagePartData,
} from '@iki/backend/chat/message_parts';
import type { ModelMessage } from 'ai';
import type { AffectSignal } from '@iki/core/emotion/affect';

export type ChatWebContents = {
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

export type ToolStreamEvent = ConversationRunnerStreamEvent;

export type RunStatusEvent = {
  runId: string;
  status: import('@iki/core/types/agent_run').AgentRunStatus;
  threadId?: string | null;
  timestamp: string;
};

export type UiChunkEmitter = {
  messageId: string;
  emitTextDelta: (delta: string) => void;
  emitToolEvent: (event: ToolStreamEvent) => void;
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
