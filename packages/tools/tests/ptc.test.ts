import { describe, expect, it } from 'vitest';
import {
  formatMcpToolCompactSignature,
  jsonSchemaToTsType,
  PtcExecuteTool,
  renderMcpNamespaceDts,
  runPtcScript,
  type PtcMcpServerDescriptor,
} from '../src/ptc';

describe('@iki/tools/ptc Programmatic Tool Calling', () => {
  it('executes TypeScript scripts with parallel tool calls, console capture, and proxy shorthand', async () => {
    const tool = new PtcExecuteTool({
      resolveWorkspace: () => '/tmp/workspace',
      listTools: () => [
        { name: 'mcp_math_mul', description: 'Multiply two numbers', source: { kind: 'mcp', id: 's1', name: 'math' } },
        { name: 'bash', description: 'Run shell command', source: { kind: 'builtin' } },
      ],
      invokeTool: async (name, rawArgs) => {
        const args = (rawArgs ?? {}) as Record<string, number>;
        if (name === 'mcp_math_mul') return { product: args.a * args.b };
        throw new Error(`Unexpected tool ${name}`);
      },
    });

    const out = (await tool.execute({
      language: 'ts',
      description: 'Compute batch products in parallel',
      code: `
        interface Pair { a: number; b: number; }
        const pairs: Pair[] = [{ a: 2, b: 3 }, { a: 4, b: 5 }, { a: 6, b: 7 }];
        const available = tools.list().map((t: { name: string }) => t.name);
        console.log('workspace:', workspace, 'tools:', available.join(','));
        const results = await Promise.all(
          pairs.map((p: Pair) => tools.mcp_math_mul(p))
        );
        const total: number = results.reduce((sum: number, r: { product: number }) => sum + r.product, 0);
        return { total, count: results.length, sandboxed: typeof process === 'undefined' };
      `,
    })) as {
      ok: boolean;
      result: { total: number; count: number; sandboxed: boolean };
      logs: string[];
      toolCallCount: number;
      toolCalls: Array<{ name: string; ok: boolean }>;
    };

    expect(out.ok).toBe(true);
    expect(out.result).toEqual({ total: 68, count: 3, sandboxed: true });
    expect(out.toolCallCount).toBe(3);
    expect(out.toolCalls.every(c => c.name === 'mcp_math_mul' && c.ok)).toBe(true);
    expect(out.logs[0]).toContain('/tmp/workspace');
    expect(out.logs[0]).toContain('mcp_math_mul');
  });

  it('enforces recursion guard, maxToolCalls, sandbox isolation, and timeout', async () => {
    const recursive = await runPtcScript(
      { code: `return await tools.call('ptc', { code: 'return 1' });` },
      { workspace: null, listTools: () => [], invokeTool: async () => 1 }
    );
    expect(recursive.ok).toBe(false);
    expect(recursive.error).toContain('Recursive `ptc`');

    const capped = await runPtcScript(
      {
        code: `
          for (let i = 0; i < 5; i++) {
            await tools.ping({ i });
          }
          return 'done';
        `,
      },
      {
        settings: { maxToolCalls: 2 },
        workspace: null,
        listTools: () => [{ name: 'ping', description: 'ping' }],
        invokeTool: async () => 'pong',
      }
    );
    expect(capped.ok).toBe(false);
    expect(capped.error).toContain('maxToolCalls');
    expect(capped.toolCallCount).toBe(2);

    const noEval = await runPtcScript(
      { code: `return new Function('return 1')();` },
      { workspace: null, listTools: () => [], invokeTool: async () => null }
    );
    expect(noEval.ok).toBe(false);

    const timedOut = await runPtcScript(
      { code: `await new Promise(() => {});`, timeoutMs: 120 },
      { workspace: null, listTools: () => [], invokeTool: async () => null }
    );
    expect(timedOut.ok).toBe(false);
    expect(timedOut.error).toContain('timed out');
  });

  it('compiles JSON Schema into compact TypeScript declarations and exposes mcp.<server>.<tool>() in sandbox', async () => {
    const schema = {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        state: { enum: ['open', 'closed'] },
        labels: { type: 'array', items: { type: 'string' } },
        'per-page': { type: 'integer' },
        filter: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['repo'],
    };

    expect(jsonSchemaToTsType(schema)).toBe(
      '{ repo: string; state?: "open" | "closed"; labels?: string[]; "per-page"?: number; filter?: string | null }'
    );

    const servers: PtcMcpServerDescriptor[] = [
      {
        id: 'mcp_gh',
        name: 'github',
        safeName: 'github',
        tools: [
          {
            name: 'list-issues',
            safeName: 'list_issues',
            description: 'List issues for a repository',
            inputSchema: schema,
          },
          {
            name: 'whoami',
            safeName: 'whoami',
            description: 'Get current user',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    ];

    expect(formatMcpToolCompactSignature(servers[0]!.tools[1]!)).toBe('whoami()');
    const dts = renderMcpNamespaceDts(servers, { server: 'github' });
    expect(dts).toContain('declare namespace mcp.github');
    expect(dts).toContain('function list_issues(args: { repo: string;');
    expect(dts).toContain('function whoami(args?: Record<string, unknown>): Promise<McpResult>;');
    expect(renderMcpNamespaceDts(servers, { server: 'missing' })).toContain('No connected MCP server');

    const out = await runPtcScript(
      {
        language: 'ts',
        code: `
          const list = mcp.servers();
          const decl = mcp.describe('github', 'list_issues');
          const [issues, me] = await Promise.all([
            mcp.github.list_issues({ repo: 'iki', state: 'open' }),
            mcp.call('github', 'whoami'),
          ]);
          return { list, hasDecl: decl.includes('list_issues'), issues, me };
        `,
      },
      {
        workspace: '/tmp/ws',
        listTools: () => [],
        invokeTool: async () => {
          throw new Error('should not call flat tools');
        },
        listMcpServers: () => servers,
        invokeMcpTool: async (serverRef, toolRef, args) => {
          if (serverRef === 'github' && toolRef === 'list_issues') {
            return { data: [{ id: 1, repo: (args as { repo: string }).repo }], text: 'ok' };
          }
          if (serverRef === 'github' && toolRef === 'whoami') {
            return { text: 'nina' };
          }
          throw new Error(`Unexpected ${serverRef}.${toolRef}`);
        },
      }
    );

    expect(out.ok).toBe(true);
    expect(out.toolCallCount).toBe(2);
    expect(out.toolCalls.map(c => c.name)).toEqual(['mcp.github.list_issues', 'mcp.github.whoami']);
    expect(out.result).toEqual({
      list: [{ name: 'github', label: 'github', toolCount: 2, tools: ['list_issues', 'whoami'] }],
      hasDecl: true,
      issues: { data: [{ id: 1, repo: 'iki' }], text: 'ok' },
      me: { text: 'nina' },
    });
  });
});
