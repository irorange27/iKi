import type { ModelMessage, UIMessage } from 'ai';

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

export type ToolStreamEvent = {
  type: string;
  [key: string]: unknown;
};

export type UiChunkEmitter = {
  messageId: string;
  emitTextDelta: (delta: string) => void;
  emitToolEvent: (event: ToolStreamEvent) => void;
  emitMemoryRetrieval: (payload: { query: string; results: Array<Record<string, unknown>> }) => void;
  finish: () => void;
  abort: () => void;
  error: (errorText: string) => void;
};
