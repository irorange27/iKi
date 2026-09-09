import { describe, expect, it } from 'vitest';

import {
  getToolCallGroupCountLabel,
  getToolCallGroupMeta,
  getToolCallPathDirectory,
  getToolCallTypeBadge,
  getToolCallVerb,
  segmentMessageParts,
} from '../../packages/desktop/src/renderer/modules/chat/ui_message_tool_groups';

const textPart = (text: string) => ({ type: 'text', text });
const reasoningPart = () => ({ type: 'reasoning', text: 'thinking' });
const dynamicTool = (overrides: Record<string, unknown>) => ({
  type: 'dynamic-tool',
  toolName: 'read_file',
  toolCallId: 'call_1',
  state: 'output-available',
  input: { path: 'src/index.ts' },
  output: 'ok',
  ...overrides,
});
const approvalPart = () => ({
  type: 'tool-approval-request',
  approvalId: 'approval_1',
  toolCallId: 'call_9',
  toolName: 'shell',
});

describe('segmentMessageParts', () => {
  it('collapses a run of consecutive tool parts into one group', () => {
    const segments = segmentMessageParts([
      textPart('hello'),
      dynamicTool({ toolCallId: 'call_1' }),
      dynamicTool({ toolCallId: 'call_2' }),
      textPart('done'),
    ]);

    expect(segments.map(segment => segment.kind)).toEqual([
      'part',
      'tool-call-group',
      'part',
    ]);
    const group = segments[1]!;
    if (group.kind !== 'tool-call-group') throw new Error('expected group');
    expect(group.parts).toHaveLength(2);
    expect(group.startIndex).toBe(1);
    expect(group.endIndex).toBe(2);
  });

  it('keeps a lone tool call as a single-member group', () => {
    const segments = segmentMessageParts([textPart('hi'), dynamicTool({})]);
    expect(segments.map(segment => segment.kind)).toEqual(['part', 'tool-call-group']);
    const group = segments[1]!;
    if (group.kind !== 'tool-call-group') throw new Error('expected group');
    expect(group.parts).toHaveLength(1);
  });

  it('drops transcript-hidden todo calls without breaking the group', () => {
    const todoCall = dynamicTool({
      toolName: 'todo',
      toolCallId: 'call_todo',
      input: { items: [] },
    });
    const segments = segmentMessageParts([
      dynamicTool({ toolCallId: 'call_1' }),
      todoCall,
      dynamicTool({ toolCallId: 'call_2' }),
    ]);

    expect(segments).toHaveLength(1);
    const group = segments[0]!;
    if (group.kind !== 'tool-call-group') throw new Error('expected group');
    expect(group.parts).toHaveLength(2);
  });

  it('breaks the group on text and stands approval requests alone', () => {
    const segments = segmentMessageParts([
      dynamicTool({ toolCallId: 'call_1' }),
      approvalPart(),
      dynamicTool({ toolCallId: 'call_2' }),
      reasoningPart(),
      dynamicTool({ toolCallId: 'call_3' }),
    ]);

    expect(segments.map(segment => segment.kind)).toEqual([
      'tool-call-group',
      'part',
      'tool-call-group',
      'part',
      'tool-call-group',
    ]);
    const first = segments[0]!;
    if (first.kind !== 'tool-call-group') throw new Error('expected group');
    expect(first.parts).toHaveLength(1);
  });
});

describe('getToolCallGroupMeta', () => {
  it('reports settled state, summed duration, and a shared verb', () => {
    const meta = getToolCallGroupMeta([
      dynamicTool({ toolCallId: 'call_1', durationMs: 1500 }),
      dynamicTool({ toolCallId: 'call_2', durationMs: 500 }),
    ]);

    expect(meta).toMatchObject({ allSettled: true, hasActive: false, totalDurationMs: 2000, verb: 'read' });
  });

  it('flags active groups and falls back to the generic verb for mixed tools', () => {
    const meta = getToolCallGroupMeta([
      dynamicTool({ toolCallId: 'call_1' }),
      dynamicTool({
        toolName: 'shell',
        toolCallId: 'call_2',
        state: 'input-streaming',
        input: { command: 'ls' },
        output: undefined,
      }),
    ]);

    expect(meta.hasActive).toBe(true);
    expect(meta.allSettled).toBe(false);
    expect(meta.verb).toBe('call');
  });
});

describe('row helpers', () => {
  it('maps tool names to verbs', () => {
    expect(getToolCallVerb(dynamicTool({}))).toBe('read');
    expect(getToolCallVerb(dynamicTool({ toolName: 'shell', input: { command: 'ls' } }))).toBe('run');
    expect(getToolCallVerb(dynamicTool({ toolName: 'mcp_abc123_lookup' }))).toBe('call');
  });

  it('derives the badge from the path extension, else the category', () => {
    expect(getToolCallTypeBadge(dynamicTool({ input: { path: 'src/app/main.ts' } }))).toBe('TS');
    expect(getToolCallTypeBadge(dynamicTool({ input: { path: 'README' } }))).toBe('FILE');
    expect(getToolCallTypeBadge(dynamicTool({ toolName: 'shell', input: { command: 'ls' } }))).toBe('SH');
    expect(getToolCallTypeBadge(dynamicTool({ toolName: 'web', input: { query: 'x' } }))).toBe('WEB');
  });

  it('returns the directory half of the path for the muted row suffix', () => {
    expect(getToolCallPathDirectory(dynamicTool({ input: { path: 'packages/app/src/main.ts' } }))).toBe(
      'packages/app/src/'
    );
    expect(getToolCallPathDirectory(dynamicTool({ input: { command: 'ls' } }))).toBe('');
  });

  it('counts files for file tools and calls otherwise', () => {
    expect(getToolCallGroupCountLabel('read', 2)).toContain('2');
    expect(getToolCallGroupCountLabel('read', 2)).toContain('file');
    expect(getToolCallGroupCountLabel('run', 3)).toContain('3');
    expect(getToolCallGroupCountLabel('run', 3)).toContain('call');
  });
});
