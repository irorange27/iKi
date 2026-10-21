// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { effect, stop } from 'vue';
import {
  getReferenceSummaries,
  getTokenUsageSummary,
} from '../../../packages/desktop/src/renderer/modules/chat/ui_message_references';
import {
  getToolUiState,
  updateToolUiState,
  resetToolUiStateMap,
} from '../../../packages/desktop/src/renderer/modules/chat/tool_ui_state';

afterEach(resetToolUiStateMap);

describe('renderer reference caches', () => {
  it('reuses summaries through off-proxy text writes and observes relevant source replacement', () => {
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
    text.text += ' delta';
    const next = getReferenceSummaries({ ...message });
    for (const key of ['tool', 'skill'] as const) expect(next[key]).toBe(first[key]);
    expect(getTokenUsageSummary({ ...message })).toBe(tokens);
    tool.toolName = 'write_file';
    expect(getReferenceSummaries(message).tool.names).toEqual(['write_file']);
    usage.data = { inputTokens: 20 };
    expect(getTokenUsageSummary(message).inputTokens).toBe(20);
    message.parts.splice(1, 1);
    expect(getReferenceSummaries(message).tool.callCount).toBe(0);
  });

  it('refreshes selected/loaded skills when their payload sources change', () => {
    const skill = {
      type: 'data-skill-usage',
      data: { mode: 'manual', skills: [{ id: 'planner', name: 'Planner', description: 'before' }] },
    };
    const loaded = {
      type: 'dynamic-tool',
      toolName: 'load_skill',
      toolCallId: 'skill',
      state: 'output-available',
      output: { id: 'planner', name: 'Planner', content: 'instructions', truncated: false },
    };
    const message = { parts: [skill, loaded] };
    const before = getReferenceSummaries(message);
    expect(before.skill.items[0].description).toBe('before');
    skill.data = {
      ...skill.data,
      skills: [{ id: 'planner', name: 'Planner', description: 'after' }],
    };
    loaded.output = { ...loaded.output, name: 'Updated planner' };
    const after = getReferenceSummaries({ ...message });
    expect(after.skill.items[0]).toMatchObject({ name: 'Updated planner', description: 'after' });
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
