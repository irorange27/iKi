import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { registerStandardTools, defaultToolRegistry } from '@iki/backend/tools';
import { delegatedAgentRuntime } from '../backend/helpers/delegated_runtime';


import { type AgentTool } from '@iki/backend/agent';

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

let toolsRegistered = false;
const ensureTools = () => {
  if (!toolsRegistered) {
    registerStandardTools({
      delegatedAgentRuntime,
    });
    toolsRegistered = true;
  }
};

export const hasProviderConfig = (): boolean => hasAuth;

export const getIntegrationTestContext = () => {
  if (!hasAuth) return null;
  return { providerType: 'deepseek' as const, model: 'deepseek-v4-flash' };
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
