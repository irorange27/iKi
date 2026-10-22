// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { effect, stop } from 'vue';

import {
  getReferenceSummaries,
  getTokenUsageSummary,
} from '../../../packages/desktop/src/renderer/modules/chat/ui_message_references';
import {
  getToolUiState,
  resetToolUiStateMap,
  updateToolUiState,
} from '../../../packages/desktop/src/renderer/modules/chat/tool_ui_state';

afterEach(resetToolUiStateMap);

describe('renderer reference caches', () => {
  it('reuses summaries until a source part is replaced', () => {
    const text = { type: 'text', text: 'first' };
    const tool = {
      type: 'dynamic-tool',
      toolName: 'read_file',
      toolCallId: 'a',
      state: 'input-available',
      input: {},
    };
    const usage = { type: 'data-token-usage', data: { inputTokens: 10 } };
    const message = { parts: [text, tool, usage] };

    const first = getReferenceSummaries(message);
    const tokens = getTokenUsageSummary(message);

    // an off-proxy text write must not invalidate a summary that does not read text
    text.text += ' delta';
    expect(getReferenceSummaries({ ...message }).tool).toBe(first.tool);
    expect(getTokenUsageSummary({ ...message })).toBe(tokens);

    // a write to a part the summary DOES read must invalidate it
    tool.toolName = 'write_file';
    expect(getReferenceSummaries(message).tool.names).toEqual(['write_file']);

    usage.data = { inputTokens: 20 };
    expect(getTokenUsageSummary(message).inputTokens).toBe(20);

    message.parts.splice(1, 1);
    expect(getReferenceSummaries(message).tool.callCount).toBe(0);
  });

  it('invalidates only the subscribed tool key, including reset and recreation', () => {
    let aRenders = 0;
    let bRenders = 0;
    const a = effect(() => {
      getToolUiState('a');
      aRenders++;
    });
    const b = effect(() => {
      getToolUiState('b');
      bRenders++;
    });
    updateToolUiState('a', { collapsed: true });
    expect([aRenders, bRenders]).toEqual([2, 1]);
    updateToolUiState('b', { durationMs: 10 });
    expect([aRenders, bRenders]).toEqual([2, 2]);
    resetToolUiStateMap();
    expect([aRenders, bRenders]).toEqual([3, 3]);
    updateToolUiState('a', { collapsed: false });
    expect([aRenders, bRenders]).toEqual([4, 3]);
    stop(a);
    stop(b);
  });
});
