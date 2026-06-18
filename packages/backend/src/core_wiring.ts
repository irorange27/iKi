import { injectFormatSkillMetadataForPrompt } from '@iki/core/context/skill_format';
import { injectEnsureThreadWorkspaceSelection } from '@iki/core/context/workspace_provider';
import { injectMcpServerStore } from '@iki/core/context/mcp_server_store';
import { injectAgentRunStore } from '@iki/core/context/agent_run_store';
import { injectGetPersonaPrompt } from '@iki/core/context/persona_provider';
import { injectGetAppConfig } from '@iki/core/context/config_provider';
import { injectProviderStore } from '@iki/core/context/provider_store';
import { injectGetUserDataPath } from '@iki/core/context/platform_provider';
import { injectFetchWithTimeout } from '@iki/core/context/network_provider';

import { formatSkillMetadataForPrompt } from './tools/skills';
import { ensureThreadWorkspaceSelection } from './workspaces/thread_workspace';
import {
  listMcpServers,
  getMcpServer,
  addMcpServer,
  updateMcpServer,
  deleteMcpServer,
} from './db/mcp_servers';
import {
  createAgentRun,
  getAgentRun,
  updateAgentRun,
  appendAgentRunStep,
  createAgentRunCheckpoint,
} from './db/agent_runs';
import { getPersonaPrompt } from './persona';
import { getAppConfig } from './config';
import { getProviders, getProvider } from './db/providers';
import { getUserDataPath } from './platform';
import { fetchWithTimeout } from './network/http';

export function wireCoreContext(): void {
  injectFormatSkillMetadataForPrompt(formatSkillMetadataForPrompt);
  injectEnsureThreadWorkspaceSelection(ensureThreadWorkspaceSelection);
  injectMcpServerStore({
    listMcpServers,
    getMcpServer,
    addMcpServer,
    updateMcpServer,
    deleteMcpServer,
  });
  injectAgentRunStore({
    createAgentRun,
    getAgentRun,
    updateAgentRun,
    appendAgentRunStep,
    createAgentRunCheckpoint,
  });
  injectGetPersonaPrompt(getPersonaPrompt);
  injectGetAppConfig(getAppConfig);
  injectProviderStore({ getProviders, getProvider });
  injectGetUserDataPath(getUserDataPath);
  injectFetchWithTimeout(fetchWithTimeout);
}
