import { beforeEach, describe, expect, it, vi } from 'vitest';

const { registerMocks, callOrder } = vi.hoisted(() => {
  const callOrder: string[] = [];
  const namedRegister = (name: string) =>
    vi.fn(() => {
      callOrder.push(name);
    });

  return {
    callOrder,
    registerMocks: {
      registerWindowIpc: namedRegister('window'),
      registerCompanionIpc: namedRegister('companion'),
      registerConfigIpc: namedRegister('config'),
      registerProvidersIpc: namedRegister('providers'),
      registerMcpIpc: namedRegister('mcp'),
      registerMemoryIpc: namedRegister('memory'),
      registerWorkspacesIpc: namedRegister('workspaces'),
      registerPromptAppsIpc: namedRegister('prompt_apps'),
      registerToolModelIpc: namedRegister('tool_model'),
      registerToolsIpc: namedRegister('tools'),
      registerUpdaterIpc: namedRegister('updater'),
      registerSkillsIpc: namedRegister('skills'),
      registerWorkflowIpc: namedRegister('workflow'),
      registerSpeechIpc: namedRegister('speech'),
      registerTasksIpc: namedRegister('tasks'),
      registerChatIpc: namedRegister('chat'),
    },
  };
});

vi.mock('../../../packages/desktop/src/main/ipc/window', () => ({
  registerWindowIpc: registerMocks.registerWindowIpc,
}));
vi.mock('../../../packages/desktop/src/main/ipc/config', () => ({
  registerConfigIpc: registerMocks.registerConfigIpc,
}));
vi.mock('../../../packages/desktop/src/main/ipc/companion', () => ({
  registerCompanionIpc: registerMocks.registerCompanionIpc,
}));
vi.mock('../../../packages/desktop/src/main/ipc/providers', () => ({
  registerProvidersIpc: registerMocks.registerProvidersIpc,
}));
vi.mock('../../../packages/desktop/src/main/ipc/mcp', () => ({
  registerMcpIpc: registerMocks.registerMcpIpc,
}));
vi.mock('../../../packages/desktop/src/main/ipc/memory', () => ({
  registerMemoryIpc: registerMocks.registerMemoryIpc,
}));
vi.mock('../../../packages/desktop/src/main/ipc/workspaces', () => ({
  registerWorkspacesIpc: registerMocks.registerWorkspacesIpc,
}));
vi.mock('../../../packages/desktop/src/main/ipc/prompt_apps', () => ({
  registerPromptAppsIpc: registerMocks.registerPromptAppsIpc,
}));
vi.mock('../../../packages/desktop/src/main/ipc/tool_model', () => ({
  registerToolModelIpc: registerMocks.registerToolModelIpc,
}));
vi.mock('../../../packages/desktop/src/main/ipc/tools', () => ({
  registerToolsIpc: registerMocks.registerToolsIpc,
}));
vi.mock('../../../packages/desktop/src/main/ipc/updater', () => ({
  registerUpdaterIpc: registerMocks.registerUpdaterIpc,
}));
vi.mock('../../../packages/desktop/src/main/ipc/skills', () => ({
  registerSkillsIpc: registerMocks.registerSkillsIpc,
}));
vi.mock('../../../packages/desktop/src/main/ipc/workflow', () => ({
  registerWorkflowIpc: registerMocks.registerWorkflowIpc,
}));
vi.mock('../../../packages/desktop/src/main/ipc/speech', () => ({
  registerSpeechIpc: registerMocks.registerSpeechIpc,
}));
vi.mock('../../../packages/desktop/src/main/ipc/tasks', () => ({
  registerTasksIpc: registerMocks.registerTasksIpc,
}));
vi.mock('../../../packages/desktop/src/main/ipc/chat', () => ({
  registerChatIpc: registerMocks.registerChatIpc,
}));

describe('main IPC registration', () => {
  beforeEach(() => {
    callOrder.length = 0;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('registers the main IPC modules once in the expected order', async () => {
    const { registerMainIpc } = await import('../../../packages/desktop/src/main/ipc/index');

    registerMainIpc();

    expect(callOrder).toEqual([
      'window',
      'companion',
      'config',
      'updater',
      'providers',
      'mcp',
      'memory',
      'workspaces',
      'prompt_apps',
      'tool_model',
      'tools',
      'skills',
      'workflow',
      'speech',
      'tasks',
      'chat',
    ]);

    registerMainIpc();

    for (const registerMock of Object.values(registerMocks)) {
      expect(registerMock).toHaveBeenCalledTimes(1);
    }
  });
});
