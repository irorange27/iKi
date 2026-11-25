import { BaseTool, type ToolRegistry } from '@iki/agent/base_tool';
import { getToolRuntimeContext } from '@iki/core/utils/runtime_context';
import type { z } from 'zod';
import { SwarmToolInputSchema } from './schema';

export type SwarmRuntimePort = {
  title: (params: { callerThreadId: string; title: string }) => unknown;
  status: (params: { callerThreadId: string }) => unknown;
  board: (params: { callerThreadId: string; limit?: number }) => unknown;
  models: (params: { callerThreadId: string; all?: boolean }) => Promise<unknown> | unknown;
  add: (params: {
    callerThreadId: string;
    name: string;
    brief: string;
    workspace?: 'inherit' | 'share' | 'branch';
    model?: string;
    fork?: string;
    n?: number;
    tasks?: string[];
  }) => Promise<unknown> | unknown;
  post: (params: { callerThreadId: string; message: string }) => unknown;
  model: (params: {
    callerThreadId: string;
    name?: string;
    model: string;
    reason?: string;
  }) => unknown;
  kill: (params: {
    callerThreadId: string;
    name: string;
    deleteBranch?: boolean;
  }) => Promise<unknown> | unknown;
};

export type SwarmToolPluginDeps = {
  getRuntime: () => SwarmRuntimePort | null | undefined;
};

export class SwarmControlTool extends BaseTool {
  private readonly deps: SwarmToolPluginDeps;

  override name = 'swarm';
  override type = 'function';
  override autoAllowed = false;
  override needsApproval = false;
  override replay = 'unsafe' as const;
  override approvalMode = 'configurable' as const;
  override description =
    'Manage and collaborate with a multi-agent swarm on a shared append-only message board. ONLY use when the user explicitly started `/swarm` or this conversation is part of an active swarm. Actions: `status`, `board` (read recent shared board entries), `models`, `add` (spawn named or sharded workers in inherit/share/branch workspaces, optionally forked), `post` (publish on the board and wake @mentioned members), `model` (switch a waiting member model keeping history), `kill` (terminate worker and clean up its worktree), `title` (coordinator sets swarm title).';
  override paramSchema = SwarmToolInputSchema;

  constructor(deps: SwarmToolPluginDeps) {
    super();
    this.deps = deps;
  }

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const runtime = this.deps.getRuntime();
    if (!runtime) {
      return {
        isError: true,
        message: 'Swarm runtime is not configured in this host session.',
      };
    }

    const callerThreadId = getToolRuntimeContext().threadId?.trim();
    if (!callerThreadId) {
      return {
        isError: true,
        message: 'Swarm tool requires an active conversation threadId.',
      };
    }

    if (args.action === 'status') {
      return runtime.status({ callerThreadId });
    }

    if (args.action === 'board') {
      return runtime.board({
        callerThreadId,
        ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
      });
    }

    if (args.action === 'models') {
      return runtime.models({ callerThreadId, ...(args.all !== undefined ? { all: args.all } : {}) });
    }

    if (args.action === 'title') {
      if (!args.title?.trim()) {
        return { isError: true, message: '`title` is required for action="title".' };
      }
      return runtime.title({ callerThreadId, title: args.title });
    }

    if (args.action === 'post') {
      if (!args.message?.trim()) {
        return { isError: true, message: '`message` is required for action="post".' };
      }
      return runtime.post({ callerThreadId, message: args.message });
    }

    if (args.action === 'add') {
      if (!args.name?.trim()) {
        return { isError: true, message: '`name` is required for action="add".' };
      }
      if (!args.brief?.trim()) {
        return { isError: true, message: '`brief` is required for action="add".' };
      }
      return runtime.add({
        callerThreadId,
        name: args.name,
        brief: args.brief,
        ...(args.workspace ? { workspace: args.workspace } : {}),
        ...(args.model ? { model: args.model } : {}),
        ...(args.fork ? { fork: args.fork } : {}),
        ...(typeof args.n === 'number' ? { n: args.n } : {}),
        ...(args.tasks ? { tasks: args.tasks } : {}),
      });
    }

    if (args.action === 'model') {
      if (!args.model?.trim()) {
        return { isError: true, message: '`model` is required for action="model".' };
      }
      return runtime.model({
        callerThreadId,
        ...(args.name ? { name: args.name } : {}),
        model: args.model,
        ...(args.reason ? { reason: args.reason } : {}),
      });
    }

    if (args.action === 'kill') {
      if (!args.name?.trim()) {
        return { isError: true, message: '`name` is required for action="kill".' };
      }
      return runtime.kill({
        callerThreadId,
        name: args.name,
        ...(typeof args.deleteBranch === 'boolean' ? { deleteBranch: args.deleteBranch } : {}),
      });
    }

    return { isError: true, message: `Unsupported swarm action "${String(args.action)}".` };
  }
}

export const createSwarmTools = (deps: SwarmToolPluginDeps): BaseTool[] => [
  new SwarmControlTool(deps),
];

export const registerSwarmTools = (
  registry: Pick<ToolRegistry, 'register'>,
  deps: SwarmToolPluginDeps
): BaseTool[] => {
  const tools = createSwarmTools(deps);
  for (const tool of tools) {
    registry.register(tool);
  }
  return tools;
};
