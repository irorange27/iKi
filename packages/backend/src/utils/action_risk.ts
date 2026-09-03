import { isShellCommandReadonly } from '@iki/backend/tools/shell_tools';

export type ActionRisk = 'safe' | 'escalate';

const ESCALATE_TOOLS = new Set(['delete_file', 'shell']);

/**
 * Classifies a single tool action for the 'trustWorkspace' approval policy
 * (ADR 005 step 2): reads and workspace-contained writes are safe; deletions
 * and non-readonly shell commands escalate. Workspace containment itself is
 * still enforced by the tools' own path resolution at execution time.
 */
export const classifyActionRisk = (toolName: string, input: unknown): ActionRisk => {
  if (toolName === 'shell') {
    const command =
      input && typeof input === 'object' && typeof (input as Record<string, unknown>).command === 'string'
        ? ((input as Record<string, unknown>).command as string)
        : '';
    return isShellCommandReadonly(command) ? 'safe' : 'escalate';
  }
  return ESCALATE_TOOLS.has(toolName) ? 'escalate' : 'safe';
};
