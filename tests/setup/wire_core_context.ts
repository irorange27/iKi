// Wire core context injection points with no-op defaults so that tests
// that don't specifically mock a context module can still run.
// Tests that DO mock a context module via vi.mock will override these
// defaults (vi.mock hoisting replaces the entire module).

import { injectGetAppConfig } from '@iki/core/context/config_provider';
import { injectProviderStore } from '@iki/core/context/provider_store';
import { injectGetUserDataPath } from '@iki/core/context/platform_provider';
import { injectFetchWithTimeout } from '@iki/core/context/network_provider';
import { injectGetPersonaPrompt } from '@iki/core/context/persona_provider';
import { injectAgentRunStore } from '@iki/core/context/agent_run_store';
import { injectMcpServerStore } from '@iki/core/context/mcp_server_store';
import { injectEnsureThreadWorkspaceSelection } from '@iki/core/context/workspace_provider';
import { injectFormatSkillMetadataForPrompt } from '@iki/core/context/skill_format';

injectGetAppConfig(() => {
  throw new Error(
    'getAppConfig not mocked. Use vi.mock("@iki/core/context/config_provider") in your test.'
  );
});

injectProviderStore({
  getProviders: () => [],
  getProvider: () => null,
});

injectGetUserDataPath(() => '/tmp/iki-test-user-data');

injectFetchWithTimeout(async () => {
  throw new Error(
    'fetchWithTimeout not mocked. Use vi.mock("@iki/core/context/network_provider") in your test.'
  );
});

injectGetPersonaPrompt(() => 'You are a helpful assistant.');

injectAgentRunStore({
  createAgentRun: () => {
    throw new Error(
      'createAgentRun not mocked. Use vi.mock("@iki/core/context/agent_run_store") in your test.'
    );
  },
  getAgentRun: () => null,
  updateAgentRun: () => null,
  appendAgentRunStep: () => {
    throw new Error(
      'appendAgentRunStep not mocked. Use vi.mock("@iki/core/context/agent_run_store") in your test.'
    );
  },
  createAgentRunCheckpoint: () => {
    throw new Error(
      'createAgentRunCheckpoint not mocked. Use vi.mock("@iki/core/context/agent_run_store") in your test.'
    );
  },
});

injectMcpServerStore({
  listMcpServers: () => [],
  getMcpServer: () => null,
  addMcpServer: () => {},
  updateMcpServer: () => {},
  deleteMcpServer: () => {},
});

injectEnsureThreadWorkspaceSelection(() => null);

injectFormatSkillMetadataForPrompt(skill => `${skill.id}: ${skill.name || ''}`);
