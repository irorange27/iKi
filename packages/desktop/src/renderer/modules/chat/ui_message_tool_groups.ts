import { isObjectRecord, isToolPart } from '@iki/backend/message/tool_parts';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';

import {
  formatDurationMs,
  getToolDurationMs,
  getToolName,
  getToolInput,
  getToolStateKind,
  getToolStateLabel,
  isApprovalRequestedPart,
  normalizeToolNameKey,
} from './ui_message_tool_calls';
import { translate } from '../../i18n';

export type ToolCallVerb =
  | 'read'
  | 'edit'
  | 'write'
  | 'delete'
  | 'run'
  | 'search'
  | 'fetch'
  | 'agent'
  | 'skill'
  | 'plan'
  | 'call';

export type MessagePartSegment =
  | { kind: 'part'; part: unknown; index: number }
  | { kind: 'tool-call-group'; parts: unknown[]; startIndex: number; endIndex: number };

const VERB_BY_TOOL_KEY: Record<string, ToolCallVerb> = {
  read_file: 'read',
  edit: 'edit',
  write_file: 'write',
  delete_file: 'delete',
  shell: 'run',
  web: 'search',
  web_search: 'search',
  fetch: 'fetch',
  agent: 'agent',
  load_skill: 'skill',
  plan: 'plan',
};

const FILE_VERBS = new Set<ToolCallVerb>(['read', 'edit', 'write', 'delete']);

export const getToolCallVerb = (part: unknown): ToolCallVerb => {
  const toolKey = normalizeToolNameKey(getToolName(part));
  return VERB_BY_TOOL_KEY[toolKey] ?? 'call';
};

export const getToolCallVerbLabel = (part: unknown): string => {
  if (getToolStateKind(part) !== 'success') return getToolStateLabel(part) || translate('toolCall.group.verb.call');
  const verb = getToolCallVerb(part);
  return translate(`toolCall.group.verb.${verb}` as Parameters<typeof translate>[0]);
};

export const getToolCallGroupCountLabel = (verb: ToolCallVerb, count: number): string => {
  const unit = FILE_VERBS.has(verb) ? 'files' : 'calls';
  return translate(`toolCall.group.${unit}` as Parameters<typeof translate>[0], { count });
};

export const getToolCallTypeBadge = (part: unknown): string => {
  const verb = getToolCallVerb(part);
  const input = getToolInput(part);
  const path =
    isObjectRecord(input) && typeof input.path === 'string' ? input.path : '';
  const basename = path.split(/[\\/]/).pop() ?? '';
  const dotIndex = basename.lastIndexOf('.');
  if (dotIndex >= 0 && dotIndex < basename.length - 1) {
    return basename.slice(dotIndex + 1).toUpperCase().slice(0, 5);
  }

  const fallbackByVerb: Partial<Record<ToolCallVerb, string>> = {
    run: 'SH',
    search: 'WEB',
    fetch: 'URL',
    agent: 'AGT',
    skill: 'SKILL',
  };
  if (fallbackByVerb[verb]) return fallbackByVerb[verb]!;
  if (path) return 'FILE';
  return '';
};

export const getToolCallPathDirectory = (part: unknown): string => {
  const input = getToolInput(part);
  const path = isObjectRecord(input) && typeof input.path === 'string' ? input.path : '';
  if (!path) return '';
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separator > 0 ? path.slice(0, separator + 1) : '';
};

export type ToolCallGroupMeta = {
  
  allSettled: boolean;
  
  hasActive: boolean;
  
  hasFailed: boolean;
  
  totalDurationMs: number | null;
  
  verb: ToolCallVerb;
};

export const getToolCallGroupMeta = (parts: unknown[]): ToolCallGroupMeta => {
  let allSettled = true;
  let hasActive = false;
  let hasFailed = false;
  let totalDurationMs: number | null = null;
  const verbs = new Set<ToolCallVerb>();

  for (const part of parts) {
    const kind = getToolStateKind(part);
    if (kind === 'running' || kind === 'pending') hasActive = true;
    if (kind === 'error' || kind === 'denied') hasFailed = true;
    if (kind !== 'success' && kind !== 'error' && kind !== 'denied') allSettled = false;

    const duration = getToolDurationMs(part);
    if (duration !== null) {
      totalDurationMs = (totalDurationMs ?? 0) + duration;
    }

    verbs.add(getToolCallVerb(part));
  }

  const firstVerb = verbs.values().next();
  const verb: ToolCallVerb = verbs.size === 1 && firstVerb.value ? firstVerb.value : 'call';

  return { allSettled, hasActive, hasFailed, totalDurationMs, verb };
};

export const getToolCallGroupTotalDurationLabel = (parts: unknown[]): string => {
  let total: number | null = null;
  for (const part of parts) {
    const duration = getToolDurationMs(part);
    if (duration !== null) total = (total ?? 0) + duration;
  }
  return total === null ? '' : formatDurationMs(total);
};

export const segmentMessageParts = (
  parts: ChatUiMessage['parts']
): MessagePartSegment[] => {
  const segments: MessagePartSegment[] = [];
  let currentGroup: { parts: unknown[]; startIndex: number } | null = null;

  const flushGroup = () => {
    if (!currentGroup) return;
    segments.push({
      kind: 'tool-call-group',
      parts: currentGroup.parts,
      startIndex: currentGroup.startIndex,
      endIndex: currentGroup.startIndex + currentGroup.parts.length - 1,
    });
    currentGroup = null;
  };

  parts.forEach((part, index) => {
    if (isToolPart(part) && !isApprovalRequestedPart(part)) {
      if (!currentGroup) currentGroup = { parts: [], startIndex: index };
      currentGroup.parts.push(part);
      return;
    }

    flushGroup();
    segments.push({ kind: 'part', part, index });
  });

  flushGroup();
  return segments;
};
