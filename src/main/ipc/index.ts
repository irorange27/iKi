import { registerChatIpc } from './chat';
import { registerConfigIpc } from './config';
import { registerLifeIpc } from './life';
import { registerMemoryIpc } from './memory';
import { registerMcpIpc } from './mcp';
import { registerPromptAppsIpc } from './prompt_apps';
import { registerProvidersIpc } from './providers';
import { registerSpeechIpc } from './speech';
import { registerSkillsIpc } from './skills';
import { registerTasksIpc } from './tasks';
import { registerToolModelIpc } from './tool_model';
import { registerToolsIpc } from './tools';
import { registerWorkflowIpc } from './workflow';
import { registerWindowIpc } from './window';
import { registerWorkspacesIpc } from './workspaces';

let mainIpcRegistered = false;

export const registerMainIpc = (): void => {
  if (mainIpcRegistered) return;
  mainIpcRegistered = true;

  registerWindowIpc();
  registerConfigIpc();
  registerLifeIpc();
  registerProvidersIpc();
  registerMcpIpc();
  registerMemoryIpc();
  registerWorkspacesIpc();
  registerPromptAppsIpc();
  registerToolModelIpc();
  registerToolsIpc();
  registerSkillsIpc();
  registerWorkflowIpc();
  registerSpeechIpc();
  registerTasksIpc();
  registerChatIpc();
};
