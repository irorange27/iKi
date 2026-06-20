import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { registerStandardTools, defaultToolRegistry } from '@iki/backend/tools';
import { createSimpleAgentRunner } from '@iki/backend/agent/runners/simple_agent_runner';
import {
  type AgentRunner,
  type AgentTool,
} from '@iki/backend/agent';

const AUTH_PATH = path.join(os.homedir(), '.iki', 'agent', 'auth.json');

const checkAuth = (): boolean => {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf-8'));
    return Object.keys(raw).length > 0;
  } catch {
    return false;
  }
};

const hasAuth = checkAuth();

// Lazy-init tools so we don't need a DB at module eval time
let toolsRegistered = false;
const ensureTools = () => {
  if (!toolsRegistered) {
    registerStandardTools();
    toolsRegistered = true;
  }
};

export const hasProviderConfig = (): boolean => hasAuth;

export const getIntegrationTestContext = () => {
  if (!hasAuth) return null;
  return { providerType: 'deepseek' as const, model: 'deepseek-chat' };
};

export const createTestRunner = (
  opts: { tools?: AgentTool[]; systemPrompt?: string; maxIterations?: number } = {}
): AgentRunner => {
  return createSimpleAgentRunner({
    systemPrompt:
      opts.systemPrompt ??
      'You are a concise AI assistant for integration testing. Answer directly and briefly.',
    providerType: 'deepseek',
    model: 'deepseek-chat',
    enableTools: (opts.tools?.length ?? 0) > 0,
    maxIterations: opts.maxIterations ?? 3,
    maxTokens: 500,
    temperature: 0.1,
  });
};

export const resolveEnabledTools = (names: string[]): AgentTool[] => {
  ensureTools();
  const tools: AgentTool[] = [];
  for (const name of names) {
    const tool = defaultToolRegistry.get(name);
    if (tool) tools.push(tool);
  }
  return tools;
};
