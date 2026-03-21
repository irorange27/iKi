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
      registerConfigIpc: namedRegister('config'),
      registerLifeIpc: namedRegister('life'),
      registerRelationshipIpc: namedRegister('relationship'),
      registerProvidersIpc: namedRegister('providers'),
      registerMcpIpc: namedRegister('mcp'),
      registerMemoryIpc: namedRegister('memory'),
      registerWorkspacesIpc: namedRegister('workspaces'),
      registerPromptAppsIpc: namedRegister('prompt_apps'),
      registerToolModelIpc: namedRegister('tool_model'),
      registerToolsIpc: namedRegister('tools'),
      registerSkillsIpc: namedRegister('skills'),
      registerWorkflowIpc: namedRegister('workflow'),
      registerSpeechIpc: namedRegister('speech'),
      registerTasksIpc: namedRegister('tasks'),
      registerChatIpc: namedRegister('chat'),
    },
  };
});

vi.mock('../../../src/main/ipc/window', () => ({
  registerWindowIpc: registerMocks.registerWindowIpc,
}));
vi.mock('../../../src/main/ipc/config', () => ({
  registerConfigIpc: registerMocks.registerConfigIpc,
}));
vi.mock('../../../src/main/ipc/life', () => ({
  registerLifeIpc: registerMocks.registerLifeIpc,
}));
vi.mock('../../../src/main/ipc/relationship', () => ({
  registerRelationshipIpc: registerMocks.registerRelationshipIpc,
}));
vi.mock('../../../src/main/ipc/providers', () => ({
  registerProvidersIpc: registerMocks.registerProvidersIpc,
}));
vi.mock('../../../src/main/ipc/mcp', () => ({
  registerMcpIpc: registerMocks.registerMcpIpc,
}));
vi.mock('../../../src/main/ipc/memory', () => ({
  registerMemoryIpc: registerMocks.registerMemoryIpc,
}));
vi.mock('../../../src/main/ipc/workspaces', () => ({
  registerWorkspacesIpc: registerMocks.registerWorkspacesIpc,
}));
vi.mock('../../../src/main/ipc/prompt_apps', () => ({
  registerPromptAppsIpc: registerMocks.registerPromptAppsIpc,
}));
vi.mock('../../../src/main/ipc/tool_model', () => ({
  registerToolModelIpc: registerMocks.registerToolModelIpc,
}));
vi.mock('../../../src/main/ipc/tools', () => ({
  registerToolsIpc: registerMocks.registerToolsIpc,
}));
vi.mock('../../../src/main/ipc/skills', () => ({
  registerSkillsIpc: registerMocks.registerSkillsIpc,
}));
vi.mock('../../../src/main/ipc/workflow', () => ({
  registerWorkflowIpc: registerMocks.registerWorkflowIpc,
}));
vi.mock('../../../src/main/ipc/speech', () => ({
  registerSpeechIpc: registerMocks.registerSpeechIpc,
}));
vi.mock('../../../src/main/ipc/tasks', () => ({
  registerTasksIpc: registerMocks.registerTasksIpc,
}));
vi.mock('../../../src/main/ipc/chat', () => ({
  registerChatIpc: registerMocks.registerChatIpc,
}));

describe('main IPC registration', () => {
  beforeEach(() => {
    callOrder.length = 0;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('registers the main IPC modules once in the expected order', async () => {
    const { registerMainIpc } = await import('../../../src/main/ipc/index');

    registerMainIpc();

    expect(callOrder).toEqual([
      'window',
      'config',
      'life',
      'relationship',
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
