import { describe, expect, it } from 'vitest';

import {
  getToolDiffLines,
  getToolDiffStat,
  getToolOutputForDisplay,
  getToolTitle,
  hasToolDiff,
  isToolCollapsed,
} from '../../packages/desktop/src/renderer/modules/chat/ui_message_tool_parts';

describe('ui_message_tool_parts', () => {
  it('uses tool input description as the card title when present', () => {
    const title = getToolTitle({
      type: 'dynamic-tool',
      toolCallId: 'call_1',
      toolName: 'shell',
      title: 'Shell',
      state: 'input-available',
      input: {
        command: 'pwd',
        description: 'Check the current working directory.',
      },
    });

    expect(title).toBe('Check the current working directory.');
  });

  it('uses a stable execution-plan title for todo tool cards', () => {
    const title = getToolTitle({
      type: 'tool-result',
      toolCallId: 'call_todo',
      toolName: 'todo',
      state: 'output-available',
      input: {
        items: [{ id: '1', text: 'Inspect current code', status: 'in_progress' }],
      },
      output: {
        items: [{ id: '1', text: 'Inspect current code', status: 'in_progress' }],
      },
    });

    expect(title).toBe('Execution Plan');
  });

  it('uses the delegated task text as the card title for agent tool cards', () => {
    const title = getToolTitle({
      type: 'tool-call',
      toolCallId: 'call_agent',
      toolName: 'agent',
      state: 'input-available',
      input: {
        task: 'Inspect the core agent runtime boundary.',
      },
    });

    expect(title).toBe('Inspect the core agent runtime boundary.');
  });

  it('collapses successful tool results by default when no UI override exists', () => {
    expect(
      isToolCollapsed({
        type: 'tool-result',
        toolCallId: 'call_shell',
        toolName: 'shell',
        state: 'output-available',
        input: {
          command: 'pwd',
        },
      })
    ).toBe(true);
  });

  it('parses edit-tool diffs into classified lines with an add/delete stat', () => {
    const part = {
      type: 'tool-result',
      toolCallId: 'call_edit',
      toolName: 'edit',
      state: 'output-available',
      input: { path: 'src/a.ts', edits: [] },
      output: {
        path: 'src/a.ts',
        success: true,
        changed: true,
        diff: [
          '--- a/src/a.ts',
          '+++ b/src/a.ts',
          '@@ -1,3 +1,3 @@',
          ' const a = 1;',
          '-const b = 2;',
          '+const b = 3;',
          '+const c = 4;',
        ].join('\n'),
      },
    };

    expect(hasToolDiff(part)).toBe(true);

    const lines = getToolDiffLines(part);
    expect(lines.map(line => line.kind)).toEqual([
      'meta',
      'meta',
      'hunk',
      'context',
      'del',
      'add',
      'add',
    ]);

    expect(getToolDiffStat(part)).toEqual({ additions: 2, deletions: 1 });
  });

  it('hides the diff field from the raw output view while keeping other fields', () => {
    const part = {
      type: 'tool-result',
      toolCallId: 'call_edit_display',
      toolName: 'edit',
      state: 'output-available',
      input: { path: 'src/a.ts', edits: [] },
      output: {
        path: 'src/a.ts',
        success: true,
        changed: true,
        diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-a\n+b',
      },
    };

    const display = getToolOutputForDisplay(part) as Record<string, unknown>;
    expect(display).toEqual({ path: 'src/a.ts', success: true, changed: true });

    const shellPart = {
      type: 'tool-result',
      toolCallId: 'call_shell_display',
      toolName: 'shell',
      state: 'output-available',
      input: { command: 'pwd' },
      output: { stdout: '/tmp' },
    };
    expect(getToolOutputForDisplay(shellPart)).toEqual({ stdout: '/tmp' });
    expect(hasToolDiff(shellPart)).toBe(false);
  });
});
