// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

import SettingsTasksSection from '../../../src/renderer/components/settings/SettingsTasksSection.vue';
import type { ChatThread } from '../../../src/shared/types/chat';
import type { ProactiveTask } from '../../../src/shared/types/tasks';

const setElectronApi = (api: unknown) => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
};

const findButtonByText = (wrapper: VueWrapper, text: string) => {
  const match = wrapper
    .findAll('button')
    .find(button => button.text().replace(/\s+/g, ' ').includes(text));

  if (!match) {
    throw new Error(`Button not found: ${text}`);
  }

  return match;
};

const findLabelByText = (wrapper: VueWrapper, text: string) => {
  const match = wrapper
    .findAll('label')
    .find(label => label.text().replace(/\s+/g, ' ').includes(text));

  if (!match) {
    throw new Error(`Label not found: ${text}`);
  }

  return match;
};

const selectSettingsOption = async (wrapper: VueWrapper, labelText: string, optionText: string) => {
  const label = findLabelByText(wrapper, labelText);
  await label.find('.settings-select-trigger').trigger('click');
  await flushPromises();

  const option = label
    .findAll('.settings-select-option')
    .find(candidate => candidate.text().replace(/\s+/g, ' ').includes(optionText));

  if (!option) {
    throw new Error(`Option not found for "${labelText}": ${optionText}`);
  }

  await option.trigger('click');
  await flushPromises();
};

const buildTask = (overrides: Partial<ProactiveTask> & Pick<ProactiveTask, 'id' | 'name'>): ProactiveTask => ({
  id: overrides.id,
  name: overrides.name,
  prompt: overrides.prompt ?? 'Summarize today',
  schedule_type: overrides.schedule_type ?? 'interval',
  interval_minutes: overrides.interval_minutes ?? 60,
  cron_expression: overrides.cron_expression ?? null,
  schedule_timezone: overrides.schedule_timezone ?? null,
  enabled: overrides.enabled ?? true,
  provider_type: overrides.provider_type ?? 'openai',
  model: overrides.model ?? 'gpt-4.1',
  tool_mode: overrides.tool_mode ?? 'auto',
  tools: overrides.tools ?? null,
  thread_id: overrides.thread_id ?? null,
  notify: overrides.notify ?? true,
  last_run_at: overrides.last_run_at ?? null,
  next_run_at: overrides.next_run_at ?? null,
  last_status: overrides.last_status ?? 'idle',
  last_output: overrides.last_output ?? null,
  last_error: overrides.last_error ?? null,
  created_at: overrides.created_at ?? '2026-03-21T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-03-21T00:00:00.000Z',
});

const buildThread = (overrides: Partial<ChatThread> & Pick<ChatThread, 'id' | 'title'>): ChatThread => ({
  id: overrides.id,
  title: overrides.title,
  model: overrides.model ?? 'gpt-4.1',
  is_generating: overrides.is_generating ?? false,
  reasoning_effort: overrides.reasoning_effort,
  metadata: overrides.metadata ?? '{}',
  created_at: overrides.created_at ?? '2026-03-21T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-03-21T00:00:00.000Z',
  client_id: overrides.client_id,
  prompt_app_id: overrides.prompt_app_id,
  tools: overrides.tools,
  is_favorited: overrides.is_favorited ?? 0,
  is_incognito: overrides.is_incognito ?? 0,
  workspace_id: overrides.workspace_id,
  enable_artifacts: overrides.enable_artifacts ?? 0,
  artifact_workspace_id: overrides.artifact_workspace_id,
  skill_ids: overrides.skill_ids,
});

const mountSettingsTasksSection = async (options?: {
  tasks?: ProactiveTask[];
  threads?: ChatThread[];
  providers?: Array<{ id: string; name: string; type: string; models: string[] }>;
}) => {
  const list = vi.fn(async () => options?.tasks ?? []);
  const create = vi.fn(async () => ({ success: true }));
  const update = vi.fn(async () => ({ success: true }));
  const runNow = vi.fn(async () => ({ success: true }));
  const removeTaskPushListener = vi.fn();
  const onPush = vi.fn();

  setElectronApi({
    tasks: {
      list,
      create,
      update,
      runNow,
      delete: vi.fn(async () => ({ success: true })),
      removeAllListeners: vi.fn(),
      onPush: vi.fn((handler: (payload: unknown) => void) => {
        onPush(handler);
        return removeTaskPushListener;
      }),
    },
    chat: {
      threads: {
        list: vi.fn(async () => options?.threads ?? []),
      },
    },
  });

  const wrapper = mount(SettingsTasksSection, {
    props: {
      active: true,
      providers:
        options?.providers ?? [
          { id: 'openai-1', name: 'OpenAI', type: 'openai', models: ['gpt-4.1'] },
        ],
    },
  });

  await flushPromises();

  return { wrapper, list, create, update, runNow, removeTaskPushListener, onPush };
};

describe('SettingsTasksSection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('links provider changes to model selection and creates a manual-tool task with normalized payload', async () => {
    const { wrapper, create } = await mountSettingsTasksSection({
      providers: [
        { id: 'openai-1', name: 'OpenAI', type: 'openai', models: ['gpt-4.1'] },
        { id: 'deepseek-1', name: 'DeepSeek', type: 'deepseek', models: ['deepseek-chat'] },
      ],
      threads: [buildThread({ id: 'thread_docs', title: 'Docs Thread' })],
    });

    await wrapper.find('input[placeholder="Daily briefing"]').setValue('Docs monitor');
    await wrapper.find('textarea[placeholder="What should this task do?"]').setValue(
      'Watch the docs and summarize changes.'
    );
    await selectSettingsOption(wrapper, 'Schedule Type', 'Cron expression');
    await wrapper.find('input[placeholder="*/15 * * * *"]').setValue('0 9 * * 1-5');
    await wrapper.find('input[placeholder="Auto (local time zone)"]').setValue('Asia/Shanghai');
    await selectSettingsOption(wrapper, 'Provider', 'DeepSeek (deepseek)');

    expect(findLabelByText(wrapper, 'Model').find('.settings-select-trigger').text()).toContain(
      'deepseek-chat'
    );

    await selectSettingsOption(wrapper, 'Push To Thread', 'Docs Thread');
    await selectSettingsOption(wrapper, 'Tool Strategy', 'Manual safe allowlist');
    await findLabelByText(wrapper, 'fetch').find('input').setValue(false);

    await findButtonByText(wrapper, 'Create Task').trigger('click');
    await flushPromises();

    expect(create).toHaveBeenCalledWith({
      name: 'Docs monitor',
      prompt: 'Watch the docs and summarize changes.',
      provider_id: 'deepseek-1',
      provider_type: 'deepseek',
      model: 'deepseek-chat',
      interval_minutes: 60,
      schedule_type: 'cron',
      cron_expression: '0 9 * * 1-5',
      schedule_timezone: 'Asia/Shanghai',
      enabled: true,
      notify: true,
      thread_id: 'thread_docs',
      tool_mode: 'manual',
      tools: ['web'],
    });
  });

  it('blocks manual mode task creation when no safe tools remain selected', async () => {
    const { wrapper, create } = await mountSettingsTasksSection();

    await wrapper.find('input[placeholder="Daily briefing"]').setValue('No tool task');
    await wrapper.find('textarea[placeholder="What should this task do?"]').setValue(
      'Try to run manually without tools.'
    );
    await selectSettingsOption(wrapper, 'Tool Strategy', 'Manual safe allowlist');
    await findLabelByText(wrapper, 'web').find('input').setValue(false);
    await findLabelByText(wrapper, 'fetch').find('input').setValue(false);

    await findButtonByText(wrapper, 'Create Task').trigger('click');
    await flushPromises();

    expect(create).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Select at least one safe tool or choose Auto/Disabled.');
  });

  it('updates notify state for an existing task through the IPC bridge', async () => {
    const task = buildTask({
      id: 'task_1',
      name: 'Morning Briefing',
      notify: true,
      tools: '["web"]',
      tool_mode: 'manual',
    });

    const { wrapper, update } = await mountSettingsTasksSection({
      tasks: [task],
    });

    const taskItem = wrapper.find('.task-item');
    await findLabelByText(taskItem, 'Notify').find('input').setValue(false);
    await flushPromises();

    expect(update).toHaveBeenCalledWith('task_1', { notify: false });
  });
});
