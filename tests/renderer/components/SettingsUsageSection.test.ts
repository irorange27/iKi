// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import SettingsUsageSection from '../../../src/renderer/components/settings/SettingsUsageSection.vue';
import type { ChatUsageSummary } from '../../../src/shared/types/chat_usage';

const buildUsageSummary = (period: ChatUsageSummary['period']): ChatUsageSummary => ({
  period,
  from: '2026-01-01T00:00:00.000Z',
  to: '2026-03-21T00:00:00.000Z',
  totals: {
    inputTokens: 1200,
    outputTokens: 300,
    totalTokens: 1500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    estimatedCostUsd: 1.234,
    messageCount: 12,
  },
  daily: [],
  monthly: [
    {
      month: '2026-03',
      inputTokens: 1200,
      outputTokens: 300,
      totalTokens: 1500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: 1.234,
      messageCount: 12,
    },
  ],
  heatmap: [
    {
      date: '2026-03-20',
      totalTokens: 400,
      messageCount: 4,
    },
  ],
});

describe('SettingsUsageSection', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    document.body.innerHTML = '';
  });

  it('reloads the usage summary when the custom period dropdown changes', async () => {
    const summary = vi.fn(async (period: ChatUsageSummary['period']) => buildUsageSummary(period));

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        chat: {
          usage: {
            summary,
          },
        },
      },
    });

    const wrapper = mount(SettingsUsageSection, {
      props: {
        active: true,
      },
      attachTo: document.body,
    });

    await flushPromises();

    expect(summary).toHaveBeenNthCalledWith(1, '30d');
    expect(wrapper.text()).toContain('Total Cost');

    await wrapper.find('.settings-select-trigger').trigger('click');

    const option = wrapper
      .findAll('.settings-select-option')
      .find(candidate => candidate.text().includes('Last 90 Days'));

    if (!option) {
      throw new Error('Last 90 Days option not found');
    }

    await option.trigger('click');
    await flushPromises();

    expect(summary).toHaveBeenNthCalledWith(2, '90d');

    wrapper.unmount();
  });
});
