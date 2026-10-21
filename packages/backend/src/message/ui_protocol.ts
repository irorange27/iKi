/**
 * iKi's conversation message protocol.
 *
 * These types used to be ALIASES of the AI SDK's (`UIMessage`, `UIMessageChunk`),
 * which made a third-party package the type authority for iKi's own persisted
 * conversation format — the format in `chat_messages.message`, the payload the
 * renderer accumulates, and the chunks that cross IPC. ADR 009 retired that
 * dependency: the shapes below are iKi's, declared once here.
 *
 * The DATA each part carries is unchanged (`MemoryPartData`, `TokenUsagePartData`
 * … live beside their producers); only the container is now ours. That keeps the
 * persisted JSON readable without a migration — an `UIMessage` was
 * `{id, role, parts}` and so is a `ChatUiMessage`.
 *
 * Streaming vocabulary: `ChatUiChunk`. It is deliberately close to Pi's
 * `AssistantMessageEvent` (which this replaced the AI SDK's stream with) —
 * `text-delta`, `reasoning-delta`, `tool-call`, `error` — because the backend
 * already reads that event stream directly, and a second translation layer
 * between Pi and the renderer would be another place to lose a part.
 */

/** Confidence-free JSON value, the only thing the wire and storage carry. */
export type UiJsonValue =
  | string
  | number
  | boolean
  | null
  | UiJsonValue[]
  | { [key: string]: UiJsonValue };

export type ChatUiRole = 'system' | 'user' | 'assistant';

/** A piece of text in a message. */
export type UiTextPart = {
  type: 'text';
  text: string;
  /** Present when the producer streamed this text in deltas. */
  state?: 'streaming' | 'done';
};

/** Model reasoning / thinking, shown collapsed by the renderer. */
export type UiReasoningPart = {
  type: 'reasoning';
  text: string;
  state?: 'streaming' | 'done';
  /** Anthropic's encrypted proof of authenticity; replayed only same-model. */
  signature?: string;
};

/** An image or file the user attached, or a tool returned. */
export type UiFilePart = {
  type: 'file';
  mediaType: string;
  /** A `data:` URL (the renderer's readAsDataURL output) or raw base64. */
  url?: string;
  filename?: string;
};

/**
 * A part carrying iKi-owned structured data.
 *
 * `TKind` is the data key (`token-usage`, `skill-usage`, …) and `TData` its
 * payload, so the resulting `type: 'data-token-usage'` stays a LITERAL. Callers
 * narrow the union with `Extract<ChatUiPart, { type: 'data-token-usage' }>`;
 * a bare `type: string` would collapse every one of those to `never`.
 */
export type UiDataPart<TKind extends string = string, TData = UiJsonValue> = {
  type: `data-${TKind}`;
  data?: TData;
};

/** The generic data-part carrier used when the caller has no specific key. */
export type UiGenericDataPart = { type: `data-${string}`; data?: unknown };

/**
 * A tool invocation as the transcript shows it.
 *
 * `state` is the approval lifecycle the UI renders: streaming input, waiting on
 * a decision, then the outcome. The backend's approval owner and the renderer's
 * controller both key on it, so it is part of this protocol rather than a
 * per-view concern.
 */
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
  /**
   * Tool arguments/outputs. Typed `unknown`, not `UiJsonValue`: the pipeline
   * passes whatever the tool produced through untouched, and a JSON-only type
   * would force every producer to validate at a boundary that does not exist.
   */
  input?: unknown;
  output?: unknown;
  errorText?: string;
  /** Set while a decision is pending or after it is made. */
  approval?: { id?: string; approved?: boolean; reason?: string };
  /** Short why-this-call line the tools ask the model to provide. */
  title?: string;
  /** Set when the PROVIDER ran the tool itself (server-side), not iKi. */
  providerExecuted?: boolean;
  /** Maps to `dynamic` on the wire: a tool the renderer did not declare. */
  dynamic?: boolean;
};

/**
 * One entry in a message's `parts`.
 *
 * Deliberately CLOSED: every member carries a literal `type`, which is what
 * makes `Extract<ChatUiPart, { type: 'text' }>` (and the ~9 sibling aliases in
 * `message_parts.ts`) resolve to a real member instead of `never`. An
 * escape-hatch `{ type: string }` member would silently destroy all of them —
 * opening the union again means adding a named member here.
 */
export type ChatUiPart =
  | UiTextPart
  | UiReasoningPart
  | UiFilePart
  | UiDynamicToolPart
  | UiGenericDataPart;

/** A persisted/rendered conversation message. */
export type ChatUiMessage = {
  id: string;
  role: ChatUiRole;
  parts: ChatUiPart[];
  /** Message metadata. `unknown`: producers attach arbitrary bookkeeping and
   * nothing validates it on the way in. */
  metadata?: unknown;
};

/* ── streaming ────────────────────────────────────────────────────────────── */

/**
 * One increment of a streaming assistant turn.
 *
 * The vocabulary mirrors what the backend actually emits, which is the Pi
 * event stream translated one-for-one (ADR 009). It is closed on purpose: the
 * renderer switches on `type`, and an unlisted member would reach it as
 * unhandled state.
 *
 * Tool lifecycle is split into fine-grained steps because the UI streams the
 * arguments: `tool-input-start` opens the card, `tool-input-delta` fills the
 * JSON as it arrives, `tool-input-available` closes it. `tool-approval-request`
 * parks the call until a decision arrives.
 */
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

export type ChatUiChunkType = ChatUiChunk['type'];

/* ── chat state machine contract ──────────────────────────────────────────── */

/**
 * What a chat transport must provide. Declared here (it used to come from the
 * AI SDK's `ChatTransport`) so the renderer's chat state machine and the IPC
 * transport agree on an iKi-owned contract.
 */
export type UiChatTransport = {
  sendMessages: (params: {
    chatId: string;
    messages: ChatUiMessage[];
    body?: Record<string, unknown>;
    abortSignal: AbortSignal;
  }) => Promise<ReadableStream<ChatUiChunk>>;
  /** A follow-up stream the backend pushes without a matching invoke. */
  reconnectToStream?: (params: {
    chatId: string;
  }) => Promise<ReadableStream<ChatUiChunk> | null>;
};

export type UiChatStatus = 'ready' | 'submitted' | 'streaming' | 'error';
