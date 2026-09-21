// @vitest-environment happy-dom

import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createPinia } from 'pinia';

import ChatComposerSelectors from '../../../packages/desktop/src/renderer/components/ChatComposerSelectors.vue';

// Workspace selection lives in the thread session store now, so the cluster
// only forwards the locked flag; the store-connected internals are stubbed out.
const WorkspaceSelectorStub = defineComponent({
  name: 'WorkspaceSelector',
  props: {
    locked: {
      type: Boolean,
      default: false,
    },
  },
  template: `
    <div
      class="workspace-selector-stub"
      :data-locked="String(locked)"
    />
  `,
});

const ReasoningSelectorStub = defineComponent({
  name: 'ReasoningSelector',
  template: `<div class="reasoning-selector-stub" />`,
});

const AutonomousSelectorStub = defineComponent({
  name: 'AutonomousSelector',
  props: {
    active: {
      type: Boolean,
      default: false,
    },
    maxIterations: {
      type: Number,
      default: 10,
    },
  },
  emits: ['update:active', 'update:maxIterations'],
  template: `
    <div
      class="autonomous-selector-stub"
      :data-active="String(active)"
      :data-max-iterations="String(maxIterations)"
    >
      <button class="autonomous-active-btn" @click="$emit('update:active', true)" />
      <button class="autonomous-iterations-btn" @click="$emit('update:maxIterations', 25)" />
    </div>
  `,
});

const mountComponent = () =>
  mount(ChatComposerSelectors, {
    props: {
      workspaceLocked: true,
      showWorkspace: true,
      autonomousActive: false,
      autonomousMaxIterations: 10,
    },
    global: {
      plugins: [createPinia()],
      stubs: {
        WorkspaceSelector: WorkspaceSelectorStub,
        ReasoningSelector: ReasoningSelectorStub,
        AutonomousSelector: AutonomousSelectorStub,
      },
    },
  });

describe('ChatComposerSelectors', () => {
  it('passes current selector state through to the owned selector cluster', () => {
    const wrapper = mountComponent();

    const workspaceSelector = wrapper.find('.workspace-selector-stub');
    expect(workspaceSelector.attributes('data-locked')).toBe('true');

    const autonomousSelector = wrapper.find('.autonomous-selector-stub');
    expect(autonomousSelector.attributes('data-active')).toBe('false');
    expect(autonomousSelector.attributes('data-max-iterations')).toBe('10');

    expect(wrapper.find('.reasoning-selector-stub').exists()).toBe(true);
  });

  it('re-emits child selector intent without owning the underlying state machine', async () => {
    const wrapper = mountComponent();

    await wrapper.find('.autonomous-active-btn').trigger('click');
    await wrapper.find('.autonomous-iterations-btn').trigger('click');

    expect(wrapper.emitted('update:autonomousActive')).toEqual([[true]]);
    expect(wrapper.emitted('update:autonomousMaxIterations')).toEqual([[25]]);
  });
});
