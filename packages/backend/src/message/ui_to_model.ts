/**
 * Convert the renderer's conversation messages into model-call messages.
 *
 * Replaces the AI SDK's `convertToModelMessages` (ADR 009). The mapping is
 * small and explicit because iKi owns both ends now:
 *
 * - `text` parts join into one text block (with blank-line separation, so a
 *   paragraph break the model saw is not silently collapsed).
 * - `file` parts become file parts carrying the media type and payload.
 * - `dynamic-tool` parts become tool exchanges: a call, and — when the part is
 *   terminal — its result. A part still waiting on approval becomes an
 *   assistant call with NO result, which is exactly what a paused turn needs:
 *   the decision is appended later by the approval owner.
 * - iKi's own data parts (`data-*`) are not model input and are dropped.
 *
 * Non-terminal tool parts are repaired upstream (`repairInterruptedToolPart`),
 * so by the time a call reaches here it either has an outcome or is a live
 * approval request.
 */
import type { ModelContentPart, ModelMessage } from './model_history';

/** The minimal part shapes this converter reads. */
type UiPartLike = {
  type: string;
  text?: unknown;
  state?: unknown;
  url?: unknown;
  mediaType?: unknown;
  filename?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
  output?: unknown;
  errorText?: unknown;
  approval?: unknown;
};

const isObjectPart = (value: unknown): value is UiPartLike =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** A tool part that has an outcome the model should see. */
const isSettledToolState = (state: string | undefined): boolean =>
  state === 'output-available' || state === 'output-error' || state === 'output-denied';

/** Whole-message text, preserving paragraph breaks between text parts. */
const joinTextParts = (parts: UiPartLike[]): string =>
  parts
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text as string)
    .filter(text => text.length > 0)
    .join('\n\n');

const toUserContent = (parts: UiPartLike[]): string | ModelContentPart[] => {
  const blocks: ModelContentPart[] = [];
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') {
      if (part.text.length === 0) continue;
      blocks.push({ type: 'text', text: part.text });
      continue;
    }
    if (part.type === 'file') {
      const mediaType = readString(part.mediaType);
      const url = readString(part.url);
      if (!mediaType || !url) continue;
      blocks.push({ type: 'file', mediaType, url });
    }
  }
  // A single text block keeps the plain-string form so the projection does not
  // have to unwrap a one-element array for the common case.
  if (blocks.length === 1 && blocks[0].type === 'text') return blocks[0].text as string;
  return blocks;
};

/**
 * One message's model projection, or null when it carries nothing the model
 * can use (a message with only data parts, or an empty draft).
 */
const toModelMessage = (role: string, parts: UiPartLike[]): ModelMessage[] => {
  if (role === 'system') {
    const text = joinTextParts(parts);
    return text ? [{ role: 'system', content: text }] : [];
  }

  if (role === 'user') {
    const content = toUserContent(parts);
    const empty = typeof content === 'string' ? content.length === 0 : content.length === 0;
    return empty ? [] : [{ role: 'user', content }];
  }

  if (role !== 'assistant') return [];

  const assistantParts: ModelContentPart[] = [];
  const toolResults: ModelContentPart[] = [];

  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') {
      if (part.text.length === 0) continue;
      assistantParts.push({ type: 'text', text: part.text });
      continue;
    }
    if (part.type === 'reasoning' && typeof part.text === 'string') {
      if (part.text.length === 0) continue;
      assistantParts.push({ type: 'reasoning', text: part.text });
      continue;
    }
    if (part.type !== 'dynamic-tool') continue;

    const toolCallId = readString(part.toolCallId);
    const toolName = readString(part.toolName);
    if (!toolCallId || !toolName) continue;

    assistantParts.push({
      type: 'tool-call',
      toolCallId,
      toolName,
      input: part.input ?? {},
    });

    const state = readString(part.state);
    if (!isSettledToolState(state)) continue;
    // A settled call pairs with exactly one tool message entry; an unsettled
    // one (pending approval) deliberately has none.
    toolResults.push({
      type: 'tool-result',
      toolCallId,
      toolName,
      output:
        state === 'output-available'
          ? { type: 'json', value: part.output ?? null }
          : {
              type: 'error-text',
              value: readString(part.errorText) ?? `tool ${state.replace('output-', '')}`,
            },
    });
  }

  const messages: ModelMessage[] = [];
  if (assistantParts.length > 0) {
    messages.push({ role: 'assistant', content: assistantParts });
  }
  if (toolResults.length > 0) {
    messages.push({ role: 'tool', content: toolResults });
  }
  return messages;
};

/**
 * Convert a normalized UI conversation into model messages.
 *
 * `carryReasoningOnAssistant` is always true here: a resumed turn replays the
 * assistant's own thinking so the provider sees the same prefix it produced.
 */
export const convertUiMessagesToModel = (messages: unknown[]): ModelMessage[] => {
  const out: ModelMessage[] = [];
  for (const raw of messages) {
    if (typeof raw !== 'object' || raw === null) continue;
    const message = raw as { role?: unknown; parts?: unknown };
    const role = typeof message.role === 'string' ? message.role : '';
    const parts = Array.isArray(message.parts) ? message.parts.filter(isObjectPart) : [];
    if (parts.length === 0) continue;
    out.push(...toModelMessage(role, parts));
  }
  return out;
};
