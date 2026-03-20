import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const invokeMock = vi.fn();
const onMock = vi.fn();
const removeAllListenersMock = vi.fn();
const sendMock = vi.fn();

let exposedApi: any = null;

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_key: string, api: unknown) => {
      exposedApi = api;
    }),
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invokeMock(...args),
    on: (...args: unknown[]) => onMock(...args),
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
      tools: ['web'],
    });
    expect(payload).not.toBe(updatesProxy);
    expect(payload.tools).not.toBe(toolsProxy);
  });

  it('sanitizes Vue reactive task payloads so Electron can structured-clone them', async () => {
    invokeMock.mockImplementation(async (_channel: string, payload: unknown) => structuredClone(payload));

    const taskForm = ref({
      name: 'Daily',
      prompt: 'Summarize',
      provider_type: 'deepseek',
      model: 'deepseek-chat',
      tools: ['web', 'fetch'],
    });

    await exposedApi.tasks.create({
      name: taskForm.value.name,
      prompt: taskForm.value.prompt,
      provider_type: taskForm.value.provider_type,
      model: taskForm.value.model,
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
      tools: ['web', 'fetch'],
    });
    expect(payload.tools).not.toBe(taskForm.value.tools);
  });

  it('forwards window shadow updates over IPC', async () => {
    exposedApi.setWindowShadow(true);

    expect(sendMock).toHaveBeenCalledWith('window:set-shadow', true);
  });
});
