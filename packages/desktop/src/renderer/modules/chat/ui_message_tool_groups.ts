import { isObjectRecord, isToolPart } from '@iki/backend/message/tool_parts';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';

import {
  formatDurationMs,
  getToolDurationMs,
  getToolName,
  getToolInput,
  isApprovalRequestedPart,
  isTranscriptHiddenToolPart,
  normalizeToolNameKey,
} from './ui_message_tool_calls';
import { translate } from '../../i18n';

/**
 * Transcript segmentation for the ZCode-style quiet tool-call rows: a run of
 * consecutive tool parts collapses into one expandable group ("查阅 · 2 文件
 * ⌄") instead of one card per call. Text, reasoning and approval breaks start
 * a new group; approvals always render standalone.
 */

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

/** The per-call action verb shown at the front of a child row. */
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
  todo: 'plan',
};

const FILE_VERBS = new Set<ToolCallVerb>(['read', 'edit', 'write', 'delete']);

export const getToolCallVerb = (part: unknown): ToolCallVerb => {
  const toolKey = normalizeToolNameKey(getToolName(part));
  return VERB_BY_TOOL_KEY[toolKey] ?? 'call';
};

export const getToolCallVerbLabel = (part: unknown): string => {
  const verb = getToolCallVerb(part);
  return translate(`toolCall.group.verb.${verb}` as Parameters<typeof translate>[0]);
};

/** Count unit: file tools count files, everything else counts calls. */
export const getToolCallGroupCountLabel = (verb: ToolCallVerb, count: number): string => {
  const unit = FILE_VERBS.has(verb) ? 'files' : 'calls';
  return translate(`toolCall.group.${unit}` as Parameters<typeof translate>[0], { count });
};

/** Short uppercase badge: path extension for file tools, category otherwise. */
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

/** Directory part of the tool's file path, shown as the muted row suffix. */
export const getToolCallPathDirectory = (part: unknown): string => {
  const input = getToolInput(part);
  const path = isObjectRecord(input) && typeof input.path === 'string' ? input.path : '';
  if (!path) return '';
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separator > 0 ? path.slice(0, separator + 1) : '';
};

export type ToolCallGroupMeta = {
  /** Every call finished (success/error/denied) — safe to collapse. */
  allSettled: boolean;
  /** Any call is running or waiting for approval — group defaults to open. */
  hasActive: boolean;
  /** Any call failed or was denied — group defaults to open so failures show. */
  hasFailed: boolean;
  /** Sum of per-call durations (null when none reported). */
  totalDurationMs: number | null;
  /** Shared verb for the group, or 'call' when the burst mixes tools. */
  verb: ToolCallVerb;
};

export const getToolCallGroupMeta = (parts: unknown[]): ToolCallGroupMeta => {
  let allSettled = true;
  let hasActive = false;
  let hasFailed = false;
  let totalDurationMs: number | null = null;
  const verbs = new Set<ToolCallVerb>();

  for (const part of parts) {
    const kind = getPartStateKind(part);
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

// Local state-kind probe kept independent of the pill helper surface —
// grouping only needs the coarse running/pending/settled distinction.
const getPartStateKind = (part: unknown): string => {
  if (!isObjectRecord(part) || typeof part.state !== 'string') return 'neutral';
  const state = part.state;
  if (state === 'output-available' || state === 'done') return 'success';
  if (state === 'output-error') return 'error';
  if (state === 'output-denied') return 'denied';
  if (state === 'approval-requested') return 'pending';
  if (state === 'input-streaming' || state === 'input-available' || state === 'approval-responded') {
    return 'running';
  }
  return 'neutral';
};

/**
 * Split renderable message parts into display segments: plain parts pass
 * through with their index (reasoning expand state keys off it), and runs of
 * consecutive tool parts collapse into groups. Hidden todo calls drop out
 * entirely; approval requests always stand alone so the approve/reject buttons
 * are never buried.
 */
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
    if (isTranscriptHiddenToolPart(part)) return;

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
