import { describe, expect, it } from 'vitest';

import { getToolTitle } from '../../src/renderer/modules/chat/ui_message_tool_parts';

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
});
