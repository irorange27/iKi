import { registerChatIpc } from './chat';
import { registerConfigIpc } from './config';
import { registerMemoryIpc } from './memory';
import { registerPromptAppsIpc } from './prompt_apps';
import { registerProvidersIpc } from './providers';
import { registerSkillsIpc } from './skills';
import { registerToolModelIpc } from './tool_model';
import { registerToolsIpc } from './tools';
import { registerWindowIpc } from './window';
import { registerWorkspacesIpc } from './workspaces';

let mainIpcRegistered = false;

export const registerMainIpc = (): void => {
  if (mainIpcRegistered) return;
  mainIpcRegistered = true;

  registerWindowIpc();
  registerConfigIpc();
  registerProvidersIpc();
  registerMemoryIpc();
  registerWorkspacesIpc();
  registerPromptAppsIpc();
  registerToolModelIpc();
  registerToolsIpc();
  registerSkillsIpc();
  registerChatIpc();
};
