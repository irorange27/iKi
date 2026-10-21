
import type { ModelContentPart, ModelMessage } from './model_history';

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

const readApproval = (approval: unknown): { id?: string; approved?: boolean } => {
  if (typeof approval !== 'object' || approval === null) return {};
  const record = approval as { id?: unknown; approved?: unknown };
  return {
    ...(typeof record.id === 'string' && record.id.length > 0 ? { id: record.id } : {}),
    ...(typeof record.approved === 'boolean' ? { approved: record.approved } : {}),
  };
};

const readableApprovalId = (approval: unknown, toolCallId: string): string =>
  readApproval(approval).id ?? toolCallId;

const isObjectPart = (value: unknown): value is UiPartLike =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const isSettledToolState = (state: string | undefined): boolean =>
  state === 'output-available' || state === 'output-error' || state === 'output-denied';

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

  if (blocks.length === 1 && blocks[0].type === 'text') return blocks[0].text as string;
  return blocks;
};

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

    const answered = readApproval(part.approval).approved;
    if (state === 'approval-requested' || (state === 'approval-responded' && answered === undefined)) {
      const approvalId = readableApprovalId(part.approval, toolCallId);
      assistantParts.push({
        type: 'tool-approval-request',
        approvalId,
        toolCallId,
        ...(toolName ? { toolName } : {}),
      });
      continue;
    }

    if (!isSettledToolState(state)) continue;

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
