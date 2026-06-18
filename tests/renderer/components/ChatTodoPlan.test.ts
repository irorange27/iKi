// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';

import ChatTodoPlan from '../../../packages/desktop/src/renderer/components/chat/ChatTodoPlan.vue';

describe('ChatTodoPlan', () => {
  it('can collapse and expand the execution plan details', async () => {
    const wrapper = mount(ChatTodoPlan, {
      props: {
        plan: {
          thread_id: 'thread_1',
          items: [
            { id: '1', text: 'Inspect current state', status: 'completed' },
            { id: '2', text: 'Implement compact card', status: 'in_progress' },
          ],
        },
      },
    });

    expect(wrapper.find('.todo-plan-list').exists()).toBe(true);

    const toggle = wrapper.find('.todo-plan-toggle');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(toggle.attributes('aria-label')).toBe('Collapse tool details');

    await toggle.trigger('click');

    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(toggle.attributes('aria-label')).toBe('Expand tool details');
    expect(wrapper.find('.todo-plan').classes()).toContain('is-collapsed');
    expect(wrapper.find('.todo-plan-list').exists()).toBe(false);

    await toggle.trigger('click');

    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(wrapper.find('.todo-plan-list').exists()).toBe(true);
  });

  it('re-expands when the thread changes', async () => {
    const wrapper = mount(ChatTodoPlan, {
      props: {
        plan: {
          thread_id: 'thread_1',
          items: [{ id: '1', text: 'Inspect current state', status: 'in_progress' }],
        },
      },
    });

    await wrapper.find('.todo-plan-toggle').trigger('click');
    expect(wrapper.find('.todo-plan-list').exists()).toBe(false);

    await wrapper.setProps({
      plan: {
        thread_id: 'thread_2',
        items: [{ id: '1', text: 'Inspect next thread', status: 'pending' }],
      },
    });

    expect(wrapper.find('.todo-plan-list').exists()).toBe(true);
    expect(wrapper.text()).toContain('Inspect next thread');
  });
});
