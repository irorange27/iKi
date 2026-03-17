import type { UIMessage } from 'ai';
import {
  Download,
  FilePenLine,
  FileText,
  Folder,
  Search,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-vue-next';

import {
  getToolInput,
  getToolName,
  getToolOutput,
  isObjectRecord,
  isToolCallPart,
  isToolPart,
  isToolResultPart,
  normalizeToolNameKey,
} from '../../../shared/chat/tool_parts';

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

const TOOL_STATE_LABELS: Record<string, string> = {
  'input-streaming': 'Running',
  'input-available': 'Queued',
  'approval-requested': 'Awaiting approval',
  'approval-responded': 'Approved',
  'output-available': 'Completed',
  'output-error': 'Failed',
  'output-denied': 'Denied',
  done: 'Done',
};

export const getToolStateLabel = (part: unknown): string => {
  if (!isObjectRecord(part) || typeof part.state !== 'string') return '';
  return TOOL_STATE_LABELS[part.state] ?? part.state;
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

const getToolDurationMs = (part: unknown): number | null => {
  if (!isObjectRecord(part)) return null;

  const explicitDuration = coerceToTimestampMs(part.durationMs);
  if (explicitDuration !== null && explicitDuration >= 0) return explicitDuration;

  const startedAt = coerceToTimestampMs(part.startedAt);
  const endedAt = coerceToTimestampMs(part.endedAt);
  if (startedAt !== null && endedAt !== null) return Math.max(0, endedAt - startedAt);

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

const TOOL_ICON_COMPONENTS: Record<string, any> = {
  web: Search,
  web_search: Search,
  fetch: Download,
  shell: Terminal,
  read_file: FileText,
  write_file: FilePenLine,
  list_dir: Folder,
  delete_file: Trash2,
};

export const getToolIconComponent = (part: unknown): any => {
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
  if (isObjectRecord(part) && typeof part.title === 'string' && part.title.trim()) {
    return normalizeSingleLineText(part.title);
  }

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

    if (toolKey === 'shell') {
      if (typeof input.command === 'string' && input.command.trim()) {
        return normalizeSingleLineText(input.command);
      }
    }

    if (
      toolKey === 'read_file' ||
      toolKey === 'write_file' ||
      toolKey === 'list_dir' ||
      toolKey === 'delete_file'
    ) {
      if (typeof input.path === 'string' && input.path.trim()) {
        return getPathBasename(input.path);
      }
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
  const input = getToolInput(part);
  const stateKind = getToolStateKind(part);

  if (stateKind === 'success' && isObjectRecord(input)) {
    const toolKey = normalizeToolNameKey(getToolName(part));

    if (toolKey === 'shell' && typeof input.command === 'string' && input.command.trim()) {
      const meta: string[] = [];
      if (typeof input.cwd === 'string' && input.cwd.trim()) {
        meta.push(`cwd: ${normalizeSingleLineText(input.cwd)}`);
      }
      if (typeof input.timeout === 'number' && Number.isFinite(input.timeout)) {
        meta.push(`timeout: ${Math.trunc(input.timeout)} ms`);
      }

      return {
        title: 'Command',
        value: input.command.trim(),
        metaText: meta.length > 0 ? meta.join(' · ') : undefined,
        isPrimary: true,
      };
    }

    if (
      (toolKey === 'web' || toolKey === 'web_search') &&
      typeof input.query === 'string' &&
      input.query.trim()
    ) {
      const meta: string[] = [];
      if (typeof input.limit === 'number' && Number.isFinite(input.limit)) {
        meta.push(`limit: ${Math.trunc(input.limit)}`);
      }

      return {
        title: 'Query',
        value: input.query.trim(),
        metaText: meta.length > 0 ? meta.join(' · ') : undefined,
        isPrimary: true,
      };
    }

    if (toolKey === 'fetch' && typeof input.url === 'string' && input.url.trim()) {
      const meta: string[] = [];
      if (typeof input.maxChars === 'number' && Number.isFinite(input.maxChars)) {
        meta.push(`maxChars: ${Math.trunc(input.maxChars)}`);
      }

      return {
        title: 'URL',
        value: input.url.trim(),
        metaText: meta.length > 0 ? meta.join(' · ') : undefined,
        isPrimary: true,
      };
    }

    if (
      (toolKey === 'read_file' ||
        toolKey === 'write_file' ||
        toolKey === 'list_dir' ||
        toolKey === 'delete_file') &&
      typeof input.path === 'string' &&
      input.path.trim()
    ) {
      const meta: string[] = [];
      if (toolKey === 'list_dir' && typeof input.recursive === 'boolean') {
        meta.push(`recursive: ${input.recursive ? 'true' : 'false'}`);
      }
      if (typeof input.encoding === 'string' && input.encoding.trim()) {
        meta.push(`encoding: ${normalizeSingleLineText(input.encoding)}`);
      }

      return {
        title: 'Path',
        value: input.path.trim(),
        metaText: meta.length > 0 ? meta.join(' · ') : undefined,
        isPrimary: true,
      };
    }
  }

  return {
    title: 'Input',
    value: input,
    isPrimary: false,
  };
};

export const getToolInputDisplayTitle = (part: unknown): string =>
  getToolInputDisplay(part).title;
export const getToolInputDisplayValue = (part: unknown): unknown =>
  getToolInputDisplay(part).value;
export const getToolInputDisplayMetaText = (part: unknown): string =>
  getToolInputDisplay(part).metaText ?? '';

export const isToolCollapsed = (part: unknown): boolean =>
  isObjectRecord(part) && part.collapsed === true;

export const canToggleToolCollapse = (part: unknown): boolean =>
  isToolCallPart(part) || isToolResultPart(part);

export const toggleToolCollapse = (_message: UIMessage, part: unknown) => {
  // Collapse state is a purely UI concern; do not persist it.
  if (!isObjectRecord(part)) return;
  part.collapsed = !isToolCollapsed(part);
};

export const getUsedToolNames = (message: any): string[] => {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const names: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    if (!isToolPart(part)) continue;
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

const parseJsonIfPossible = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

export const getWebSearchCitations = (part: unknown): WebSearchCitation[] => {
  if (!isToolResultPart(part)) return [];
  const toolName = getToolName(part).toLowerCase();
  if (toolName !== 'web' && toolName !== 'web_search' && toolName !== 'web-search') {
    return [];
  }

  const outputRaw = parseJsonIfPossible(getToolOutput(part));
  if (!isObjectRecord(outputRaw)) return [];

  const results = outputRaw.results;
  if (!Array.isArray(results)) return [];

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
