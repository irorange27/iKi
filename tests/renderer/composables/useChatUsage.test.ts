// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ref, watch } from 'vue';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';
import { createReactiveChatState } from '../../../packages/desktop/src/renderer/modules/chat/chat_instance';
import { createChatMessageStore } from '../../../packages/desktop/src/renderer/modules/chat/chat_message_store';
import { useChatUsage } from '../../../packages/desktop/src/renderer/composables/useChatUsage';

const message = (id: string, tokens: number): ChatUiMessage => ({
  id,
  role: 'assistant',
  parts: [
    { type: 'text', text: 'answer', state: 'streaming' },
    { type: 'data-token-usage', data: { inputTokens: tokens, outputTokens: 5, llmMs: 100 } },
  ],
});

describe('chat usage invalidation at the SDK message-store boundary', () => {
  it('publishes history revision only after a same-length replacement is applied', () => {
    const { state, messagesArray } = createReactiveChatState(() => undefined);
    const store = createChatMessageStore({ messages: messagesArray });
    store.setAll([message('old', 10)]);
    const usage = useChatUsage(
      () => state.messages,
      () => store.revision,
      ref(0)
    );
    const observed: number[] = [];
    const stop = watch(
      usage.sessionPerfStats,
      value => {
        observed.push(value?.inputTokens ?? 0);
      },
      { flush: 'sync' }
    );
    store.setAll([message('new', 20)]);
    expect(observed).toEqual([20]);
    stop();
  });

  it('does no history reads for text deltas and refreshes payload replacements, history loads and truncation', () => {
    const { state, messagesArray } = createReactiveChatState(() => undefined);
    const store = createChatMessageStore({ messages: messagesArray });
    const tick = ref(0);
    const usage = useChatUsage(
      () => state.messages,
      () => store.revision,
      tick
    );
    let historyReads = 0;
    const history = Array.from({ length: 100 }, (_, i) => {
      const item = message(`old-${i}`, 10);
      const parts = item.parts;
      Object.defineProperty(item, 'parts', {
        get: () => {
          historyReads++;
          return parts;
        },
      });
      return item;
    });
    const active = message('active', 20);
    store.setAll([...history, active]);
    const stats = usage.sessionPerfStats.value;
    const latest = usage.latestAssistantTokenUsage.value;
    expect(stats?.inputTokens).toBe(1020);
    historyReads = 0;
    for (let delta = 0; delta < 100; delta++) {
      active.parts[0] = { type: 'text', state: 'streaming', text: `delta ${delta}` };
      state.replaceMessage(100, active);
      expect(usage.sessionPerfStats.value).toBe(stats);
      expect(usage.latestAssistantTokenUsage.value).toBe(latest);
    }
    expect(historyReads).toBe(0);
    active.parts[1] = { type: 'data-token-usage', data: { inputTokens: 40 } };
    state.replaceMessage(100, active);
    tick.value++;
    expect(usage.latestAssistantTokenUsage.value?.inputTokens).toBe(40);
    expect(usage.sessionPerfStats.value?.inputTokens).toBe(1040);
    const refreshed = usage.sessionPerfStats.value;
    tick.value++;
    expect(usage.sessionPerfStats.value).toBe(refreshed);
    store.setAll(Array.from({ length: 101 }, (_, i) => message(`replacement-${i}`, 2)));
    expect(usage.sessionPerfStats.value?.inputTokens).toBe(202);
    expect(usage.latestAssistantTokenUsage.value?.inputTokens).toBe(2);
    store.truncateAfterIndex(0);
    expect(usage.sessionPerfStats.value?.rounds).toBe(1);
    store.clear();
    expect(usage.sessionPerfStats.value).toBeNull();
    expect(usage.latestAssistantTokenUsage.value).toBeNull();
  });
});
