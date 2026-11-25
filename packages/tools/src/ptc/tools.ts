import { BaseTool, type ToolRegistry } from '@iki/agent/base_tool';
import type { PtcToolSettings } from '@iki/core/domain/settings';
import { getToolRuntimeContext } from '@iki/core/utils/runtime_context';
import type { z } from 'zod';
import { runPtcScript, type PtcToolDescriptor } from './runner';
import { PtcToolInputSchema } from './schema';
import type { PtcMcpServerDescriptor } from './ts_types';

export type PtcToolPluginDeps = {
  getSettings?: () => Partial<PtcToolSettings> | null | undefined;
  listTools: () => PtcToolDescriptor[];
  invokeTool: (toolName: string, args: unknown) => Promise<unknown>;
  listMcpServers?: () => PtcMcpServerDescriptor[];
  invokeMcpTool?: (serverRef: string, toolRef: string, args: unknown) => Promise<unknown>;
  resolveWorkspace?: () => Promise<string | null> | string | null;
};

export class PtcExecuteTool extends BaseTool {
  private readonly deps: PtcToolPluginDeps;

  override name = 'ptc';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override replay = 'unsafe' as const;
  override approvalMode = 'configurable' as const;
  override description =
    'Programmatic Tool Calling (PTC): run a sandboxed async TypeScript/JavaScript snippet to orchestrate built-in tools (`tools.<name>(args)`) and MCP servers as TypeScript APIs (`await mcp.<server>.<tool>(args)`). Inspect MCP signatures on demand via `mcp.servers()` and `mcp.describe(server?, tool?)`. Chain loops or parallel `Promise.all` calls and return only the concise final result. Globals: `mcp`, `tools`, `workspace`, `console`, `sleep(ms)`. MCP calls return `{ content, text, data? }` (`data` is parsed JSON when applicable).';
  override paramSchema = PtcToolInputSchema;

  constructor(deps: PtcToolPluginDeps) {
    super();
    this.deps = deps;
  }

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const runtime = getToolRuntimeContext();
    const workspace = (await this.deps.resolveWorkspace?.()) ?? null;
    const execution = await runPtcScript(
      {
        code: args.code,
        ...(args.language ? { language: args.language } : {}),
        ...(typeof args.timeoutMs === 'number' ? { timeoutMs: args.timeoutMs } : {}),
      },
      {
        settings: this.deps.getSettings?.(),
        workspace,
        listTools: this.deps.listTools,
        invokeTool: this.deps.invokeTool,
        ...(this.deps.listMcpServers ? { listMcpServers: this.deps.listMcpServers } : {}),
        ...(this.deps.invokeMcpTool ? { invokeMcpTool: this.deps.invokeMcpTool } : {}),
        ...(runtime.abortSignal ? { signal: runtime.abortSignal } : {}),
      }
    );

    if (!execution.ok) {
      return {
        isError: true,
        ...execution,
      };
    }

    return execution;
  }
}

export const createPtcTools = (deps: PtcToolPluginDeps): BaseTool[] => [
  new PtcExecuteTool(deps),
];

export const registerPtcTools = (
  registry: Pick<ToolRegistry, 'register'>,
  deps: PtcToolPluginDeps
): BaseTool[] => {
  const tools = createPtcTools(deps);
  for (const tool of tools) {
    registry.register(tool);
  }
  return tools;
};
