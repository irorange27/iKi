import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { ElectronApi } from '../../src/shared/types/electron_api';

const invokeMock = vi.fn();
const onMock = vi.fn();
const removeListenerMock = vi.fn();
const removeAllListenersMock = vi.fn();
const sendMock = vi.fn();

let exposedApi: ElectronApi | null = null;

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_key: string, api: unknown) => {
      exposedApi = api;
    }),
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invokeMock(...args),
    on: (...args: unknown[]) => onMock(...args),
    removeListener: (...args: unknown[]) => removeListenerMock(...args),
    removeAllListeners: (...args: unknown[]) => removeAllListenersMock(...args),
    send: (...args: unknown[]) => sendMock(...args),
  },
}));

const loadPreload = async () => {
  exposedApi = null;
  await import('../../src/preload/index');
  if (!exposedApi) throw new Error('electronAPI was not exposed');
};

describe('preload task IPC payload serialization', () => {
  beforeEach(async () => {
    vi.resetModules();
    invokeMock.mockReset();
    onMock.mockReset();
    removeListenerMock.mockReset();
    removeAllListenersMock.mockReset();
    sendMock.mockReset();
    await loadPreload();
  });

  it('serializes task create payloads before invoke', async () => {
    invokeMock.mockResolvedValue({ success: true });

    const toolsProxy = new Proxy(['web', 'fetch'], {});
    const taskProxy = new Proxy(
      {
        name: 'Daily',
        prompt: 'Summarize',
        provider_type: 'deepseek',
        model: 'deepseek-chat',
        tool_mode: 'manual',
        tools: toolsProxy,
      },
      {}
    );

    await exposedApi.tasks.create(taskProxy);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [channel, payload] = invokeMock.mock.calls[0];
    expect(channel).toBe('tasks:create');
    expect(payload).toEqual({
      name: 'Daily',
      prompt: 'Summarize',
      provider_type: 'deepseek',
      model: 'deepseek-chat',
      tool_mode: 'manual',
      tools: ['web', 'fetch'],
    });
    expect(payload).not.toBe(taskProxy);
    expect(payload.tools).not.toBe(toolsProxy);
  });

  it('serializes task update payloads before invoke', async () => {
    invokeMock.mockResolvedValue({ success: true });

    const toolsProxy = new Proxy(['web'], {});
    const updatesProxy = new Proxy(
      {
        enabled: true,
        tool_mode: 'disabled',
        tools: toolsProxy,
      },
      {}
    );

    await exposedApi.tasks.update('task_1', updatesProxy);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [channel, id, payload] = invokeMock.mock.calls[0];
    expect(channel).toBe('tasks:update');
    expect(id).toBe('task_1');
    expect(payload).toEqual({
      enabled: true,
      tool_mode: 'disabled',
      tools: ['web'],
    });
    expect(payload).not.toBe(updatesProxy);
    expect(payload.tools).not.toBe(toolsProxy);
  });

  it('sanitizes Vue reactive task payloads so Electron can structured-clone them', async () => {
    invokeMock.mockImplementation(async (_channel: string, payload: unknown) =>
      structuredClone(payload)
    );

    const taskForm = ref({
      name: 'Daily',
      prompt: 'Summarize',
      provider_type: 'deepseek',
      model: 'deepseek-chat',
      tool_mode: 'manual',
      tools: ['web', 'fetch'],
    });

    await exposedApi.tasks.create({
      name: taskForm.value.name,
      prompt: taskForm.value.prompt,
      provider_type: taskForm.value.provider_type,
      model: taskForm.value.model,
      tool_mode: taskForm.value.tool_mode,
      tools: taskForm.value.tools,
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [channel, payload] = invokeMock.mock.calls[0];
    expect(channel).toBe('tasks:create');
    expect(() => structuredClone(payload)).not.toThrow();
    expect(payload).toEqual({
      name: 'Daily',
      prompt: 'Summarize',
      provider_type: 'deepseek',
      model: 'deepseek-chat',
      tool_mode: 'manual',
      tools: ['web', 'fetch'],
    });
    expect(payload.tools).not.toBe(taskForm.value.tools);
  });

  it('forwards window shadow updates over IPC', async () => {
    exposedApi.setWindowShadow(true);

    expect(sendMock).toHaveBeenCalledWith('window:set-shadow', true);
  });

  it('forwards model discovery overrides when fetching models from the renderer', async () => {
    invokeMock.mockResolvedValue([]);

    await exposedApi.chat.getModels('acp', undefined, {
      type: 'acp',
      acp_command: 'codex',
      acp_args: '--profile default',
    });

    expect(invokeMock).toHaveBeenCalledWith('chat:getModels', 'acp', undefined, {
      type: 'acp',
      acp_command: 'codex',
      acp_args: '--profile default',
    });
  });

  it('exposes the shared Electron API contract across renderer namespaces', async () => {
    invokeMock.mockResolvedValue({});

    const configUpdated = vi.fn();
    const updateStatusChanged = vi.fn();
    const chatChunk = vi.fn();
    const taskPush = vi.fn();
    const speechProgress = vi.fn();

    await exposedApi.config.get();
    await exposedApi.config.getRuntimeInfo();
    await exposedApi.config.getDaemonStatus();
    await exposedApi.config.getDaemonLogs(10);
    await exposedApi.config.controlDaemon('restart');
    await exposedApi.config.testNetwork({
      proxy: {
        enable: true,
        type: 'socks5',
        host: '127.0.0.1',
        port: 1080,
      },
      webSearch: {
        preferredEngine: 'google',
      },
      timeout: 5000,
      retryAttempts: 3,
    });
    await exposedApi.config.set({} as never);
    exposedApi.config.onUpdated(configUpdated);
    await exposedApi.updates.getStatus();
    await exposedApi.updates.check();
    await exposedApi.updates.install();
    exposedApi.updates.onStatusChanged(updateStatusChanged);
    exposedApi.updates.removeAllListeners();

    await exposedApi.providers.list();
    await exposedApi.providers.get('provider_1');
    await exposedApi.providers.add({
      id: 'provider_1',
      name: 'OpenAI',
      type: 'openai',
      api_key: 'secret',
      models: '["gpt-4.1"]',
    });
    await exposedApi.providers.update('provider_1', { enabled: true });
    await exposedApi.providers.delete('provider_1');
    const removeProviderListener = exposedApi.providers.onUpdated(vi.fn());
    removeProviderListener();

    await exposedApi.chat.getModels('openai');
    await exposedApi.chat.isProviderConfigured('openai');
    await exposedApi.chat.send({
      providerType: 'openai',
      model: 'gpt-4.1',
      messages: [],
    });
    await exposedApi.chat.stream({
      providerType: 'openai',
      model: 'gpt-4.1',
      messages: [],
      tools: ['web'],
    });
    await exposedApi.chat.stopStream();
    exposedApi.chat.onUiChunk(chatChunk);
    await exposedApi.chat.approveTool('approval_1', true);
    exposedApi.chat.removeAllListeners();
    await exposedApi.chat.threads.list();
    await exposedApi.chat.threads.get('thread_1');
    await exposedApi.chat.threads.getTodoPlan('thread_1');
    await exposedApi.chat.threads.create({ title: 'Thread' });
    await exposedApi.chat.threads.update('thread_1', { title: 'Updated' });
    await exposedApi.chat.threads.delete('thread_1');
    await exposedApi.chat.messages.list('thread_1');
    await exposedApi.chat.messages.get('message_1');
    await exposedApi.chat.messages.create({ thread_id: 'thread_1', message: '{}' });
    await exposedApi.chat.messages.update('message_1', { message: '{}' });
    await exposedApi.chat.messages.delete('message_1');
    await exposedApi.chat.usage.summary('30d');

    await exposedApi.memory.short.list('thread_1', 5);
    await exposedApi.memory.short.add({
      thread_id: 'thread_1',
      message_id: 'message_1',
      role: 'user',
      content: 'hello',
    });
    await exposedApi.memory.short.listAll(5);
    await exposedApi.memory.long.add({
      thread_id: 'thread_1',
      summary: 'summary',
    });
    await exposedApi.memory.long.update('memory_1', { summary: 'updated' });
    await exposedApi.memory.long.delete('memory_1');
    await exposedApi.memory.long.list('thread_1', 5);
    await exposedApi.memory.long.listAll(5);
    await exposedApi.memory.long.search('thread_1', 'query', { limit: 3 });
    await exposedApi.memory.long.searchAll('query', { limit: 3 });
    await exposedApi.memory.affect.get('thread_1');

    await exposedApi.workspaces.list();
    await exposedApi.workspaces.get('workspace_1');
    await exposedApi.workspaces.getByPath('/tmp');
    await exposedApi.workspaces.getVisible();
    await exposedApi.workspaces.pickDirectory();
    await exposedApi.workspaces.create({ id: 'workspace_1', path: '/tmp', name: 'tmp' });
    await exposedApi.workspaces.update('workspace_1', { name: 'tmp-2' });
    await exposedApi.workspaces.delete('workspace_1');
    await exposedApi.workspaces.toggleVisibility('workspace_1');

    await exposedApi.promptApps.list();
    await exposedApi.promptApps.get('app_1');
    await exposedApi.promptApps.getEnabled();
    await exposedApi.promptApps.create({ id: 'app_1', name: 'App' });
    await exposedApi.promptApps.update('app_1', { description: 'Updated' });
    await exposedApi.promptApps.delete('app_1');
    await exposedApi.promptApps.toggleEnabled('app_1');
    await exposedApi.promptApps.updateSortOrder('app_1', 3);

    await exposedApi.toolModel.get();
    await exposedApi.toolModel.generateTitle('Conversation');
    await exposedApi.toolModel.testLatency({
      providerId: 'provider-openai',
      model: 'gpt-4o-mini',
    });
    await exposedApi.tools.list();

    await exposedApi.speech.getStatus();
    await exposedApi.speech.transcribe({ audioBase64: 'ZmFrZQ==', mimeType: 'audio/webm' });
    await exposedApi.speech.listModels();
    await exposedApi.speech.downloadModel('base.en');
    exposedApi.speech.onDownloadProgress(speechProgress);
    exposedApi.speech.removeAllListeners();

    await exposedApi.skills.list();
    await exposedApi.skills.roots();
    await exposedApi.skills.openRoot('user');
    await exposedApi.skills.openSkill('skill_1');
    await exposedApi.skills.read('skill_1', { maxChars: 500 });

    await exposedApi.workflow.resetAutoPinnedSkills();

    await exposedApi.tasks.list();
    await exposedApi.tasks.get('task_1');
    await exposedApi.tasks.runNow('task_1');
    exposedApi.tasks.onPush(taskPush);
    exposedApi.tasks.removeAllListeners();

    await exposedApi.mcp.list();
    await exposedApi.mcp.add({ name: 'Docs', transport: 'stdio', command: 'node' });
    await exposedApi.mcp.update('server_1', { enabled: true });
    await exposedApi.mcp.delete('server_1');
    await exposedApi.mcp.connect('server_1');
    await exposedApi.mcp.disconnect('server_1');
    await exposedApi.mcp.refreshTools('server_1');

    exposedApi.openSettings('provider');
    exposedApi.closeWindow();

    expect(invokeMock.mock.calls.map(call => call[0])).toEqual(
      expect.arrayContaining([
        'config:get',
        'config:get-runtime-info',
        'config:get-daemon-status',
        'config:get-daemon-logs',
        'config:control-daemon',
        'config:test-network',
        'config:set',
        'updates:get-status',
        'updates:check',
        'updates:install',
        'providers:list',
        'providers:get',
        'providers:add',
        'providers:update',
        'providers:delete',
        'chat:getModels',
        'chat:isProviderConfigured',
        'chat:send',
        'chat:stream',
        'chat:stop-stream',
        'chat:approve-tool',
        'chat:threads:list',
        'chat:threads:get',
        'chat:threads:todo:get',
        'chat:threads:create',
        'chat:threads:update',
        'chat:threads:delete',
        'chat:messages:list',
        'chat:messages:get',
        'chat:messages:create',
        'chat:messages:update',
        'chat:messages:delete',
        'chat:usage:summary',
        'memory:short:list',
        'memory:short:add',
        'memory:short:listAll',
        'memory:long:add',
        'memory:long:update',
        'memory:long:delete',
        'memory:long:list',
        'memory:long:listAll',
        'memory:long:search',
        'memory:long:searchAll',
        'memory:affect:get',
        'workspaces:list',
        'workspaces:get',
        'workspaces:getByPath',
        'workspaces:getVisible',
        'workspaces:pickDirectory',
        'workspaces:create',
        'workspaces:update',
        'workspaces:delete',
        'workspaces:toggleVisibility',
        'promptApps:list',
        'promptApps:get',
        'promptApps:getEnabled',
        'promptApps:create',
        'promptApps:update',
        'promptApps:delete',
        'promptApps:toggleEnabled',
        'promptApps:updateSortOrder',
        'toolModel:get',
        'toolModel:generateTitle',
        'toolModel:testLatency',
        'tools:list',
        'speech:get-status',
        'speech:transcribe',
        'speech:list-models',
        'speech:download-model',
        'skills:list',
        'skills:roots',
        'skills:open-root',
        'skills:open-skill',
        'skills:read',
        'workflow:reset-auto-skills',
        'tasks:list',
        'tasks:get',
        'tasks:run-now',
        'mcp:list',
        'mcp:add',
        'mcp:update',
        'mcp:delete',
        'mcp:connect',
        'mcp:disconnect',
        'mcp:refresh-tools',
      ])
    );
    expect(onMock.mock.calls.map(call => call[0])).toEqual(
      expect.arrayContaining([
        'config:updated',
        'updates:status-changed',
        'providers:updated',
        'chat:ui-chunk',
        'speech:download-progress',
        'tasks:push',
      ])
    );
    expect(removeAllListenersMock.mock.calls.map(call => call[0])).toEqual(
      expect.arrayContaining([
        'chat:ui-chunk',
        'updates:status-changed',
        'speech:download-progress',
        'tasks:push',
      ])
    );
    expect(removeListenerMock).toHaveBeenCalledWith('providers:updated', expect.any(Function));
    expect(sendMock.mock.calls).toEqual(
      expect.arrayContaining([
        ['open-settings', 'provider'],
        ['close-window'],
      ])
    );
  });
});
