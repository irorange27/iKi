

export type UiJsonValue =
  | string
  | number
  | boolean
  | null
  | UiJsonValue[]
  | { [key: string]: UiJsonValue };

export type ChatUiRole = 'system' | 'user' | 'assistant';

export type UiTextPart = {
  type: 'text';
  text: string;

  state?: 'streaming' | 'done';
};

export type UiReasoningPart = {
  type: 'reasoning';
  text: string;
  state?: 'streaming' | 'done';

  signature?: string;
};

export type UiFilePart = {
  type: 'file';
  mediaType: string;

  url?: string;
  filename?: string;
};

export type UiDataPart<TKind extends string = string, TData = UiJsonValue> = {
  type: `data-${TKind}`;
  data?: TData;
};

export type UiGenericDataPart = { type: `data-${string}`; data?: unknown };

export type UiDynamicToolPart = {
  type: 'dynamic-tool';
  toolCallId: string;
  toolName: string;
  state:
    | 'input-streaming'
    | 'input-available'
    | 'approval-requested'
    | 'approval-responded'
    | 'output-available'
    | 'output-error'
    | 'output-denied';

  input?: unknown;
  output?: unknown;
  errorText?: string;

  approval?: { id?: string; approved?: boolean; reason?: string };

  title?: string;

  providerExecuted?: boolean;

  dynamic?: boolean;
};

export type ChatUiPart =
  | UiTextPart
  | UiReasoningPart
  | UiFilePart
  | UiDynamicToolPart
  | UiGenericDataPart;

export type ChatUiMessage = {
  id: string;
  role: ChatUiRole;
  parts: ChatUiPart[];

  metadata?: unknown;
};

export type ChatUiChunk =
  | { type: 'start'; messageId: string }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; delta: string }
  | { type: 'reasoning-end'; id: string }
  | {
      type: 'tool-input-start';
      toolCallId: string;
      toolName: string;
      title?: string;
      dynamic: true;
    }
  | { type: 'tool-input-delta'; toolCallId: string; inputTextDelta: string }
  | {
      type: 'tool-input-available';
      toolCallId: string;
      toolName?: string;
      input?: unknown;
      dynamic?: true;
    }
  | {
      type: 'tool-input-error';
      toolCallId: string;
      toolName?: string;
      errorText: string;
      input?: unknown;
      dynamic?: true;
    }
  | {
      type: 'tool-output-available';
      toolCallId: string;
      toolName?: string;
      output?: unknown;
      dynamic?: true;
      preliminary?: boolean;
    }
  | {
      type: 'tool-output-error';
      toolCallId: string;
      toolName?: string;
      errorText?: string;
      dynamic?: true;
    }
  | {
      type: 'tool-output-denied';
      toolCallId: string;
      toolName?: string;
      reason?: string;
      dynamic?: true;
    }
  | {
      type: 'tool-approval-request';
      approvalId: string;
      toolCallId: string;
      toolName?: string;
      input?: unknown;
    }
  | { type: `data-${string}`; id?: string; data?: unknown }
  | { type: 'error'; errorText: string }
  | { type: 'abort' }
  | { type: 'finish'; messageId?: string };

export type UiChatTransport = {
  sendMessages: (params: {
    chatId: string;
    messages: ChatUiMessage[];
    body?: Record<string, unknown>;
    abortSignal: AbortSignal;
  }) => Promise<ReadableStream<ChatUiChunk>>;

  reconnectToStream?: (params: {
    chatId: string;
  }) => Promise<ReadableStream<ChatUiChunk> | null>;
};

export type UiChatStatus = 'ready' | 'submitted' | 'streaming' | 'error';
