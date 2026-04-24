import type { Component } from 'vue';
import {
  Bot,
  Clock3,
  Download,
  FilePenLine,
  FileText,
  Folder,
  ListTodo,
  Search,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-vue-next';

import {
  getToolCallIdFromPart,
  getToolInput,
  getToolName,
  getToolOutput,
  isObjectRecord,
  isToolCallPart,
  isToolPart,
  isToolResultPart,
  normalizeToolNameKey,
} from '../../../shared/chat/tool_parts';
import type { ChatUiMessage } from '../../../shared/chat/message_parts';
import {
  parseToolInput,
  parseToolOutput,
  type ParsedToolInput,
  type ParsedToolOutput,
} from '../../../shared/chat/tool_payloads';
import { translate } from '../../i18n';
import { getToolUiState, updateToolUiState } from './tool_ui_state';

export {
  getApprovalId,
  getToolCallIdFromPart,
  getToolInput,
  getToolName,
  getToolOutput,
  isApprovalRequestedPart,
  isToolCallPart,
  isToolPart,
  isToolResultPart,
  normalizeToolNameKey,
  parseToolInputFromText,
} from '../../../shared/chat/tool_parts';

export type WebSearchCitation = {
  title: string;
  url: string;
  domain: string;
};

const TOOL_STATE_LABEL_KEYS: Record<string, Parameters<typeof translate>[0]> = {
  'input-streaming': 'chat.tool.state.running',
  'input-available': 'chat.tool.state.queued',
  'approval-requested': 'chat.tool.state.awaitingApproval',
  'approval-responded': 'chat.tool.state.approved',
  'output-available': 'chat.tool.state.completed',
  'output-error': 'chat.tool.state.failed',
  'output-denied': 'chat.tool.state.denied',
  done: 'chat.tool.state.done',
};

export const getToolStateLabel = (part: unknown): string => {
  if (!isObjectRecord(part) || typeof part.state !== 'string') return '';
  const key = TOOL_STATE_LABEL_KEYS[part.state];
  return key ? translate(key) : part.state;
};

type ToolStateKind = 'success' | 'error' | 'denied' | 'pending' | 'running' | 'neutral';

export const getToolStateKind = (part: unknown): ToolStateKind => {
  if (!isObjectRecord(part) || typeof part.state !== 'string') return 'neutral';

  const state = part.state;
  if (state === 'output-available' || state === 'done') return 'success';
  if (state === 'output-error') return 'error';
  if (state === 'output-denied') return 'denied';
  if (state === 'approval-requested') return 'pending';
  if (
    state === 'input-streaming' ||
    state === 'input-available' ||
    state === 'approval-responded'
  ) {
    return 'running';
  }

  return 'neutral';
};

export const getToolStatePillClass = (part: unknown): string =>
  `tool-state-${getToolStateKind(part)}`;

const coerceToTimestampMs = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();

    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) return asNumber;

    const parsedIso = Date.parse(trimmed);
    if (!Number.isNaN(parsedIso)) return parsedIso;
  }

  return null;
};

type ParsedToolPayload = {
  input: ParsedToolInput;
  output: ParsedToolOutput;
  rawInput: unknown;
  rawOutput: unknown;
  toolName: string;
};

const toolPayloadCache = new WeakMap<object, ParsedToolPayload>();

const getParsedToolPayload = (part: unknown): ParsedToolPayload => {
  if (!isObjectRecord(part)) {
    return {
      input: { kind: 'unknown', input: undefined },
      output: { kind: 'unknown', output: undefined },
      rawInput: undefined,
      rawOutput: undefined,
      toolName: 'tool',
    };
  }

  const cached = toolPayloadCache.get(part);
  const rawInput = getToolInput(part);
  const rawOutput = getToolOutput(part);
  const toolName = getToolName(part);

  if (
    cached &&
    cached.toolName === toolName &&
    Object.is(cached.rawInput, rawInput) &&
    Object.is(cached.rawOutput, rawOutput)
  ) {
    return cached;
  }

  const payload: ParsedToolPayload = {
    input: parseToolInput(toolName, rawInput),
    output: parseToolOutput(toolName, rawOutput),
    rawInput,
    rawOutput,
    toolName,
  };

  toolPayloadCache.set(part, payload);
  return payload;
};

export const getParsedToolInput = (part: unknown): ParsedToolInput =>
  getParsedToolPayload(part).input;

export const getParsedToolOutput = (part: unknown): ParsedToolOutput =>
  getParsedToolPayload(part).output;

const getToolDurationMs = (part: unknown): number | null => {
  const toolCallId = getToolCallIdFromPart(part);
  const uiState = toolCallId ? getToolUiState(toolCallId) : undefined;

  const explicitDuration = coerceToTimestampMs(uiState?.durationMs);
  if (explicitDuration !== null && explicitDuration >= 0) return explicitDuration;

  const startedAt = coerceToTimestampMs(uiState?.startedAt);
  const endedAt = coerceToTimestampMs(uiState?.endedAt);
  if (startedAt !== null && endedAt !== null) return Math.max(0, endedAt - startedAt);

  if (isObjectRecord(part)) {
    const fallbackDuration = coerceToTimestampMs(part.durationMs);
    if (fallbackDuration !== null && fallbackDuration >= 0) return fallbackDuration;

    const fallbackStart = coerceToTimestampMs(part.startedAt);
    const fallbackEnd = coerceToTimestampMs(part.endedAt);
    if (fallbackStart !== null && fallbackEnd !== null) {
      return Math.max(0, fallbackEnd - fallbackStart);
    }
  }

  return null;
};

const formatDurationMs = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const secondsTotal = ms / 1000;

  const formatSeconds = (seconds: number) => {
    const fixed = seconds.toFixed(1);
    return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
  };

  if (secondsTotal < 60) {
    return `${formatSeconds(secondsTotal)} s`;
  }

  const minutes = Math.floor(secondsTotal / 60);
  const seconds = Math.round(secondsTotal % 60);
  return `${minutes}m ${seconds}s`;
};

export const getToolDurationLabel = (part: unknown): string => {
  const ms = getToolDurationMs(part);
  if (ms === null) return '';
  return formatDurationMs(ms);
};

const TOOL_ICON_COMPONENTS: Record<string, Component> = {
  web: Search,
  web_search: Search,
  fetch: Download,
  shell: Terminal,
  read_file: FileText,
  edit: FilePenLine,
  write_file: FilePenLine,
  list_dir: Folder,
  delete_file: Trash2,
  agent: Bot,
  todo: ListTodo,
  list_awaiters: Clock3,
  read_awaiter: Clock3,
  write_awaiter: Clock3,
  delete_awaiter: Trash2,
  list_todo_lists: ListTodo,
  read_todo_list: ListTodo,
  write_todo_list: ListTodo,
  delete_todo_list: Trash2,
  list_proactive_tasks: Clock3,
  read_proactive_task: Clock3,
  write_proactive_task: Clock3,
  delete_proactive_task: Trash2,
};

export const getToolIconComponent = (part: unknown): Component => {
  const rawName = getToolName(part);
  const toolKey = typeof rawName === 'string' ? normalizeToolNameKey(rawName) : 'tool';
  return TOOL_ICON_COMPONENTS[toolKey] || Wrench;
};

const normalizeSingleLineText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const getPathBasename = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const segments = trimmed.split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : trimmed;
};

export const getToolTitle = (part: unknown): string => {
  const input = getToolInput(part);
  if (isObjectRecord(input)) {
    const descriptionCandidate =
      typeof input.description === 'string'
        ? input.description
        : typeof input.reason === 'string'
          ? input.reason
          : typeof input.rationale === 'string'
            ? input.rationale
            : '';
    if (descriptionCandidate.trim()) {
      return normalizeSingleLineText(descriptionCandidate);
    }
  }

  if (isObjectRecord(part) && typeof part.title === 'string' && part.title.trim()) {
    return normalizeSingleLineText(part.title);
  }

  const rawName = getToolName(part);
  const toolKey = typeof rawName === 'string' ? normalizeToolNameKey(rawName) : 'tool';

  if (isObjectRecord(input)) {
    if (toolKey === 'web' || toolKey === 'web_search') {
      if (typeof input.query === 'string' && input.query.trim()) {
        return normalizeSingleLineText(input.query);
      }
    }

    if (toolKey === 'fetch') {
      if (typeof input.url === 'string' && input.url.trim()) {
        return normalizeSingleLineText(input.url);
      }
    }

    if (toolKey === 'agent') {
      if (typeof input.task === 'string' && input.task.trim()) {
        return normalizeSingleLineText(input.task);
      }
    }

    if (toolKey === 'shell') {
      if (typeof input.command === 'string' && input.command.trim()) {
        return normalizeSingleLineText(input.command);
      }
    }

    if (
      toolKey === 'read_file' ||
      toolKey === 'edit' ||
      toolKey === 'write_file' ||
      toolKey === 'list_dir' ||
      toolKey === 'delete_file'
    ) {
      if (typeof input.path === 'string' && input.path.trim()) {
        return getPathBasename(input.path);
      }
    }

    if (
      toolKey === 'read_todo_list' ||
      toolKey === 'write_todo_list' ||
      toolKey === 'delete_todo_list'
    ) {
      if (typeof input.title === 'string' && input.title.trim()) {
        return normalizeSingleLineText(input.title);
      }
      if (typeof input.id === 'string' && input.id.trim()) {
        return normalizeSingleLineText(input.id);
      }
    }

    if (
      toolKey === 'read_awaiter' ||
      toolKey === 'write_awaiter' ||
      toolKey === 'delete_awaiter'
    ) {
      if (typeof input.title === 'string' && input.title.trim()) {
        return normalizeSingleLineText(input.title);
      }
      if (typeof input.currentTitle === 'string' && input.currentTitle.trim()) {
        return normalizeSingleLineText(input.currentTitle);
      }
      if (typeof input.id === 'string' && input.id.trim()) {
        return normalizeSingleLineText(input.id);
      }
    }

    if (
      toolKey === 'read_proactive_task' ||
      toolKey === 'write_proactive_task' ||
      toolKey === 'delete_proactive_task'
    ) {
      if (typeof input.name === 'string' && input.name.trim()) {
        return normalizeSingleLineText(input.name);
      }
      if (typeof input.currentName === 'string' && input.currentName.trim()) {
        return normalizeSingleLineText(input.currentName);
      }
      if (typeof input.id === 'string' && input.id.trim()) {
        return normalizeSingleLineText(input.id);
      }
    }

    if (toolKey === 'list_proactive_tasks') {
      if (typeof input.query === 'string' && input.query.trim()) {
        return normalizeSingleLineText(input.query);
      }
      return 'Proactive tasks';
    }

    if (toolKey === 'list_awaiters') {
      if (typeof input.query === 'string' && input.query.trim()) {
        return normalizeSingleLineText(input.query);
      }
      return 'Awaiters';
    }

    if (toolKey === 'list_todo_lists') {
      if (typeof input.query === 'string' && input.query.trim()) {
        return normalizeSingleLineText(input.query);
      }
      return 'Todo lists';
    }

    if (toolKey === 'todo') {
      return translate('chat.tool.executionPlan');
    }
  }

  if (typeof rawName === 'string' && rawName.trim()) {
    return normalizeSingleLineText(rawName);
  }

  return 'tool';
};

type ToolInputDisplay = {
  title: string;
  value: unknown;
  metaText?: string;
  isPrimary: boolean;
};

const getToolInputDisplay = (part: unknown): ToolInputDisplay => {
  const parsedInput = getParsedToolInput(part);
  const input = parsedInput.kind === 'unknown' ? getToolInput(part) : parsedInput.input;
  const stateKind = getToolStateKind(part);

  if (stateKind === 'success' && isObjectRecord(input)) {
    const toolKey =
      parsedInput.kind === 'unknown' ? normalizeToolNameKey(getToolName(part)) : parsedInput.kind;

    if (toolKey === 'shell' && typeof input.command === 'string' && input.command.trim()) {
      const meta: string[] = [];
      if (typeof input.cwd === 'string' && input.cwd.trim()) {
        meta.push(translate('chat.tool.meta.cwd', { value: normalizeSingleLineText(input.cwd) }));
      }
      if (typeof input.timeout === 'number' && Number.isFinite(input.timeout)) {
        meta.push(translate('chat.tool.meta.timeout', { value: Math.trunc(input.timeout) }));
      }

      return {
        title: translate('chat.tool.command'),
        value: input.command.trim(),
        metaText: meta.length > 0 ? meta.join(' · ') : undefined,
        isPrimary: true,
      };
    }

    if (toolKey === 'web' && typeof input.query === 'string' && input.query.trim()) {
      const meta: string[] = [];
      if (typeof input.limit === 'number' && Number.isFinite(input.limit)) {
        meta.push(translate('chat.tool.meta.limit', { value: Math.trunc(input.limit) }));
      }

      return {
        title: translate('chat.tool.query'),
        value: input.query.trim(),
        metaText: meta.length > 0 ? meta.join(' · ') : undefined,
        isPrimary: true,
      };
    }

    if (toolKey === 'fetch' && typeof input.url === 'string' && input.url.trim()) {
      const meta: string[] = [];
      if (typeof input.maxChars === 'number' && Number.isFinite(input.maxChars)) {
        meta.push(translate('chat.tool.meta.maxChars', { value: Math.trunc(input.maxChars) }));
      }

      return {
        title: translate('chat.tool.url'),
        value: input.url.trim(),
        metaText: meta.length > 0 ? meta.join(' · ') : undefined,
        isPrimary: true,
      };
    }

    if (toolKey === 'agent' && typeof input.task === 'string' && input.task.trim()) {
      const meta: string[] = [];
      if (Array.isArray(input.tools) && input.tools.length > 0) {
        meta.push(
          translate('chat.tool.meta.tools', {
            value: input.tools
              .filter((tool): tool is string => typeof tool === 'string' && tool.trim().length > 0)
              .join(', '),
          })
        );
      }
      if (typeof input.maxIterations === 'number' && Number.isFinite(input.maxIterations)) {
        meta.push(
          translate('chat.tool.meta.maxIterations', {
            value: Math.trunc(input.maxIterations),
          })
        );
      }

      return {
        title: translate('chat.tool.task'),
        value: input.task.trim(),
        metaText: meta.length > 0 ? meta.join(' · ') : undefined,
        isPrimary: true,
      };
    }

    if (
      (toolKey === 'read_file' ||
        toolKey === 'edit' ||
        toolKey === 'write_file' ||
        toolKey === 'list_dir' ||
        toolKey === 'delete_file') &&
      typeof input.path === 'string' &&
      input.path.trim()
    ) {
      const meta: string[] = [];
      if (toolKey === 'list_dir' && typeof input.recursive === 'boolean') {
        meta.push(
          translate('chat.tool.meta.recursive', { value: input.recursive ? 'true' : 'false' })
        );
      }
      if (typeof input.encoding === 'string' && input.encoding.trim()) {
        meta.push(
          translate('chat.tool.meta.encoding', {
            value: normalizeSingleLineText(input.encoding),
          })
        );
      }

      return {
        title: translate('chat.tool.path'),
        value: input.path.trim(),
        metaText: meta.length > 0 ? meta.join(' · ') : undefined,
        isPrimary: true,
      };
    }

    if (toolKey === 'list_todo_lists') {
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      const meta: string[] = [];
      if (typeof input.limit === 'number' && Number.isFinite(input.limit)) {
        meta.push(translate('chat.tool.meta.limit', { value: Math.trunc(input.limit) }));
      }

      return {
        title: translate('chat.tool.query'),
        value: query || translate('chat.tool.allTodoLists'),
        metaText: meta.length > 0 ? meta.join(' · ') : undefined,
        isPrimary: true,
      };
    }

    if (
      (toolKey === 'read_todo_list' ||
        toolKey === 'write_todo_list' ||
        toolKey === 'delete_todo_list') &&
      ((typeof input.title === 'string' && input.title.trim()) ||
        (typeof input.id === 'string' && input.id.trim()))
    ) {
      return {
        title: translate('chat.tool.todoList'),
        value:
          (typeof input.title === 'string' && input.title.trim()) ||
          (typeof input.id === 'string' && input.id.trim()) ||
          '',
        isPrimary: true,
      };
    }
  }

  return {
    title: translate('chat.tool.input'),
    value: input,
    isPrimary: false,
  };
};

export const getToolInputDisplayTitle = (part: unknown): string => getToolInputDisplay(part).title;
export const getToolInputDisplayValue = (part: unknown): unknown => getToolInputDisplay(part).value;
export const getToolInputDisplayMetaText = (part: unknown): string =>
  getToolInputDisplay(part).metaText ?? '';

export const isTranscriptHiddenToolPart = (part: unknown): boolean =>
  normalizeToolNameKey(getToolName(part)) === 'todo';

export const isToolCollapsed = (part: unknown): boolean => {
  const toolCallId = getToolCallIdFromPart(part);
  const uiState = toolCallId ? getToolUiState(toolCallId) : undefined;
  if (uiState && typeof uiState.collapsed === 'boolean') {
    return uiState.collapsed;
  }

  return getToolStateKind(part) === 'success';
};

export const canToggleToolCollapse = (part: unknown): boolean =>
  isToolCallPart(part) || isToolResultPart(part);

export const toggleToolCollapse = (_message: ChatUiMessage, part: unknown) => {
  // Collapse state is a purely UI concern; do not persist it.
  const toolCallId = getToolCallIdFromPart(part);
  if (!toolCallId) return;
  updateToolUiState(toolCallId, { collapsed: !isToolCollapsed(part) });
};

export const getUsedToolNames = (message: unknown): string[] => {
  const parts = isObjectRecord(message) && Array.isArray(message.parts) ? message.parts : [];
  const names: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    if (!isToolPart(part)) continue;
    if (isTranscriptHiddenToolPart(part)) continue;
    const rawName = getToolName(part);
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name || name === 'tool') continue;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }

  return names;
};

const getUrlDomain = (value: string): string => {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

export const getWebSearchCitations = (part: unknown): WebSearchCitation[] => {
  if (!isToolResultPart(part)) return [];
  const parsedOutput = getParsedToolOutput(part);
  if (parsedOutput.kind !== 'web') {
    return [];
  }

  const results = Array.isArray(parsedOutput.output.results) ? parsedOutput.output.results : [];

  const seen = new Set<string>();
  const citations: WebSearchCitation[] = [];

  for (const item of results) {
    if (!isObjectRecord(item)) continue;
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!url || seen.has(url)) continue;
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : url;
    citations.push({
      title,
      url,
      domain: getUrlDomain(url),
    });
    seen.add(url);
  }

  return citations;
};

export const hasWebSearchCitations = (part: unknown): boolean =>
  getWebSearchCitations(part).length > 0;

export const hasDisplayValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isObjectRecord(value)) return Object.keys(value).length > 0;
  return true;
};

export const formatJson = (value: unknown): string => {
  if (value === undefined) return '';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};
