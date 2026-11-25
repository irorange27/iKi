import { McpManager } from './manager';

let manager: McpManager | null = null;

export const getMcpManager = (): McpManager => {
  if (!manager) {
    manager = new McpManager();
  }
  return manager;
};

export type { McpManager } from './manager';
export {
  findDefaultMcpJsonPath,
  parseMcpJsonConfig,
  readMcpJsonFile,
} from './config_import';
export {
  buildMcpDeltaReminderText,
  resolveMcpAnchoredReminders,
} from './mcp_delta';
