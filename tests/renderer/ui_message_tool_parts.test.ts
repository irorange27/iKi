import { describe, expect, it } from 'vitest';

import {
  getToolTitle,
  isToolCollapsed,
} from '../../src/renderer/modules/chat/ui_message_tool_parts';

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

  it('keeps successful todo results expanded by default', () => {
    expect(
      isToolCollapsed({
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
      })
    ).toBe(false);
  });
});
