import type { ModelMessage, UIMessage } from 'ai';
import type { ConversationRunnerStreamEvent } from '../../../core/agent';
import type { ContextReportItem } from '../../../shared/chat/message_parts';
import type { AffectSignal } from '../../../shared/emotion/affect';

export type ChatWebContents = {
  id: number;
  send: (channel: string, ...args: unknown[]) => void;
};

export type ChatInputMessage = ModelMessage;
export type ChatUiMessage = UIMessage;
export type ChatTransportMessage = ChatInputMessage | ChatUiMessage;

export type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ActiveStreamState = {
  cancelled: boolean;
  stoppedByUser: boolean;
  abortController: AbortController;
};

export type ToolStreamEvent = ConversationRunnerStreamEvent;

export type UiChunkEmitter = {
  messageId: string;
  emitTextDelta: (delta: string) => void;
  emitToolEvent: (event: ToolStreamEvent) => void;
  emitMemoryRetrieval: (payload: {
    query: string;
    results: Array<Record<string, unknown>>;
  }) => void;
  emitAffectSignal: (payload: AffectSignal) => void;
  emitContextReport: (payload: {
    totalEstimatedTokens: number;
    retainedRecentMessages: number;
    compactedMessages: number;
    blocks: ContextReportItem[];
  }) => void;
  finish: () => void;
  abort: () => void;
  error: (errorText: string) => void;
};
