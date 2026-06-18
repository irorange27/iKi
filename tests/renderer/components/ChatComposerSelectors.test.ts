// @vitest-environment happy-dom

import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { Provider } from '@iki/core/types/provider';
import ChatComposerSelectors from '../../../packages/desktop/src/renderer/components/ChatComposerSelectors.vue';

const provider: Provider = {
  id: 'openai',
  name: 'OpenAI',
  type: 'openai',
  api_key: '',
  models: '["gpt-4.1"]',
  enabled: true,
  created_at: '2026-03-21T00:00:00.000Z',
  updated_at: '2026-03-21T00:00:00.000Z',
  available_models: '[]',
};

const WorkspaceSelectorStub = defineComponent({
  name: 'WorkspaceSelector',
  props: {
    selectedWorkspaceId: {
      type: String,
      default: null,
    },
    locked: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:selectedWorkspaceId'],
  template: `
    <button
      class="workspace-selector-stub"
      :data-workspace-id="selectedWorkspaceId"
      :data-locked="String(locked)"
      @click="$emit('update:selectedWorkspaceId', 'workspace_next')"
    />
  `,
});

const SkillSelectorStub = defineComponent({
  name: 'SkillSelector',
  props: {
    skillIds: {
      type: Array<string>,
      default: () => [],
    },
    mode: {
      type: String as () => 'manual' | 'auto',
      default: 'auto',
    },
  },
  emits: ['update:skillIds', 'update:mode'],
  template: `
    <div
      class="skill-selector-stub"
      :data-skill-ids="skillIds.join(',')"
      :data-mode="mode"
    >
      <button class="skill-ids-btn" @click="$emit('update:skillIds', ['skill_docs'])" />
      <button class="skill-mode-btn" @click="$emit('update:mode', 'manual')" />
    </div>
  `,
});

const ToolSelectorStub = defineComponent({
  name: 'ToolSelector',
  props: {
    tools: {
      type: Array<string>,
      default: () => [],
    },
    mcpServerIds: {
      type: Array<string>,
      default: () => [],
    },
    mode: {
      type: String as () => 'manual' | 'auto',
      default: 'auto',
    },
  },
  emits: ['update:tools', 'update:mcpServerIds', 'update:mode'],
  template: `
    <div
      class="tool-selector-stub"
      :data-tools="tools.join(',')"
      :data-mcp-server-ids="mcpServerIds.join(',')"
      :data-mode="mode"
    >
      <button class="tools-btn" @click="$emit('update:tools', ['web'])" />
      <button class="mcp-btn" @click="$emit('update:mcpServerIds', ['docs_server'])" />
      <button class="tool-mode-btn" @click="$emit('update:mode', 'manual')" />
    </div>
  `,
});

const ChatModelSelectorStub = defineComponent({
  name: 'ChatModelSelector',
  props: {
    availableProviders: {
      type: Array<Provider>,
      default: () => [],
    },
    selectedProvider: {
      type: Object as () => Provider | null,
      default: null,
    },
    selectedModel: {
      type: String,
      default: '',
    },
  },
  emits: ['select'],
  template: `
    <button
      class="chat-model-selector-stub"
      :data-provider-count="availableProviders.length"
      :data-selected-provider-id="selectedProvider?.id ?? ''"
      :data-selected-model="selectedModel"
      @click="$emit('select', { provider: availableProviders[0], model: 'gpt-4.1' })"
    />
  `,
});

const mountComponent = () =>
  mount(ChatComposerSelectors, {
    props: {
      selectedWorkspaceId: 'workspace_docs',
      workspaceLocked: true,
      selectedSkillIds: ['skill_repo'],
      skillMode: 'auto',
      selectedTools: ['search'],
      selectedMcpServerIds: ['repo_server'],
      toolMode: 'auto',
      availableProviders: [provider],
      selectedProvider: provider,
      selectedModel: 'gpt-4o',
    },
    global: {
      stubs: {
        WorkspaceSelector: WorkspaceSelectorStub,
        SkillSelector: SkillSelectorStub,
        ToolSelector: ToolSelectorStub,
        ChatModelSelector: ChatModelSelectorStub,
      },
    },
  });

describe('ChatComposerSelectors', () => {
  it('passes current selector state through to the owned selector cluster', () => {
    const wrapper = mountComponent();

    const workspaceSelector = wrapper.find('.workspace-selector-stub');
    expect(workspaceSelector.attributes('data-workspace-id')).toBe('workspace_docs');
    expect(workspaceSelector.attributes('data-locked')).toBe('true');

    const skillSelector = wrapper.find('.skill-selector-stub');
    expect(skillSelector.attributes('data-skill-ids')).toBe('skill_repo');
    expect(skillSelector.attributes('data-mode')).toBe('auto');

    const toolSelector = wrapper.find('.tool-selector-stub');
    expect(toolSelector.attributes('data-tools')).toBe('search');
    expect(toolSelector.attributes('data-mcp-server-ids')).toBe('repo_server');
    expect(toolSelector.attributes('data-mode')).toBe('auto');

    const modelSelector = wrapper.find('.chat-model-selector-stub');
    expect(modelSelector.attributes('data-provider-count')).toBe('1');
    expect(modelSelector.attributes('data-selected-provider-id')).toBe('openai');
    expect(modelSelector.attributes('data-selected-model')).toBe('gpt-4o');
  });

  it('re-emits child selector intent without owning the underlying state machine', async () => {
    const wrapper = mountComponent();

    await wrapper.find('.workspace-selector-stub').trigger('click');
    await wrapper.find('.skill-ids-btn').trigger('click');
    await wrapper.find('.skill-mode-btn').trigger('click');
    await wrapper.find('.tools-btn').trigger('click');
    await wrapper.find('.mcp-btn').trigger('click');
    await wrapper.find('.tool-mode-btn').trigger('click');
    await wrapper.find('.chat-model-selector-stub').trigger('click');

    expect(wrapper.emitted('update:selectedWorkspaceId')).toEqual([['workspace_next']]);
    expect(wrapper.emitted('update:selectedSkillIds')).toEqual([[['skill_docs']]]);
    expect(wrapper.emitted('update:skillMode')).toEqual([['manual']]);
    expect(wrapper.emitted('update:selectedTools')).toEqual([[['web']]]);
    expect(wrapper.emitted('update:selectedMcpServerIds')).toEqual([[['docs_server']]]);
    expect(wrapper.emitted('update:toolMode')).toEqual([['manual']]);
    expect(wrapper.emitted('selectProviderModel')).toEqual([
      [{ provider, model: 'gpt-4.1' }],
    ]);
  });
});
