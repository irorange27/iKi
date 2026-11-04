import type { HarnessConfig } from '../harness/harness_types';
import type { AgentTool } from '../types';
import { getErrorMessage } from '@iki/backend/utils/errors';
import { withRetry } from '@iki/backend/utils/retry';
import {
  getToolRuntimeContext,
  runWithToolRuntimeContext,
} from '@iki/backend/utils/runtime_context';
import { normalizeToolOutput } from '@iki/backend/message/model_history';
import { resolveThreadWorkspaceSelectionSnapshot } from '@iki/backend/workspaces/thread_workspace';

export const createRawToolRunner = (
  tools: AgentTool[],
  config: HarnessConfig,
  inheritedBox?: { selection: unknown }
) => {
  const byName = new Map(tools.map(tool => [tool.name, tool]));

  const workspaceSelectionBox = inheritedBox ??
    getToolRuntimeContext().workspaceSelectionBox ?? {
      selection: config.threadId ? resolveThreadWorkspaceSelectionSnapshot(config.threadId) : null,
    };
  return async (
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown> => {
    const tool = byName.get(toolName);
    if (!tool) {
      throw new Error(`Unknown tool "${toolName}".`);
    }
    return runWithToolRuntimeContext(
      {
        ...getToolRuntimeContext(),
        ...(config.threadId ? { threadId: config.threadId } : {}),
        abortSignal: signal,
        availableTools: tools,
        availableSkillIds: config.availableSkillIds,
        workspaceSelectionBox,
      },
      async () => {
        const invoke = () => tool.handler(structuredClone(args));
        return tool.retry ? withRetry(invoke, tool.retry)() : invoke();
      }
    );
  };
};

export const defaultPiToolExecutor = (
  tools: AgentTool[],
  config: HarnessConfig,
  inheritedBox?: { selection: unknown }
) => {
  const runRaw = createRawToolRunner(tools, config, inheritedBox);
  return async (
    call: { name: string; arguments: Record<string, unknown> },
    signal?: AbortSignal
  ): Promise<unknown> => {
    try {
      const value = await runRaw(call.name, call.arguments, signal);
      return normalizeToolOutput(value);
    } catch (error) {
      return { type: 'error-text', value: getErrorMessage(error) };
    }
  };
};
