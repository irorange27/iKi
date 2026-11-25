import * as nodeModule from 'node:module';
import vm from 'node:vm';
import {
  PtcToolSettingsSchema,
  type PtcToolSettings,
} from '@iki/core/domain/settings';
import {
  renderMcpNamespaceDts,
  type PtcMcpServerDescriptor,
} from './ts_types';

export type PtcToolDescriptor = {
  name: string;
  description: string;
  parameters?: unknown;
  source?: {
    kind: 'builtin' | 'mcp';
    id?: string;
    name?: string;
  };
};

export type PtcToolCallTrace = {
  name: string;
  durationMs: number;
  ok: boolean;
  error?: string;
};

export type PtcExecutionResult = {
  ok: boolean;
  result?: unknown;
  error?: string;
  logs: string[];
  toolCalls: PtcToolCallTrace[];
  toolCallCount: number;
  durationMs: number;
  truncated: boolean;
};

export type PtcExecutionDeps = {
  settings?: Partial<PtcToolSettings> | null;
  workspace: string | null;
  listTools: () => PtcToolDescriptor[];
  invokeTool: (toolName: string, args: unknown) => Promise<unknown>;
  listMcpServers?: () => PtcMcpServerDescriptor[];
  invokeMcpTool?: (serverRef: string, toolRef: string, args: unknown) => Promise<unknown>;
  signal?: AbortSignal;
};

const DEFAULT_PTC_SETTINGS: PtcToolSettings = PtcToolSettingsSchema.parse({});

export const resolvePtcToolSettings = (
  override?: Partial<PtcToolSettings> | null
): PtcToolSettings => {
  if (!override) return DEFAULT_PTC_SETTINGS;
  const parsed = PtcToolSettingsSchema.safeParse({
    ...DEFAULT_PTC_SETTINGS,
    ...override,
  });
  return parsed.success ? parsed.data : DEFAULT_PTC_SETTINGS;
};

const safeStringify = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    const seen = new WeakSet<object>();
    return (
      JSON.stringify(value, (_key, val) => {
        if (typeof val === 'bigint') return val.toString();
        if (val instanceof Error) return { name: val.name, message: val.message };
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      }) ?? String(value)
    );
  } catch {
    return String(value);
  }
};

const boundJsonValue = (
  value: unknown,
  maxBytes: number
): { value: unknown; truncated: boolean } => {
  if (value === undefined) return { value: null, truncated: false };
  const serialized = safeStringify(value);
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) {
    try {
      return { value: JSON.parse(serialized), truncated: false };
    } catch {
      return { value: serialized, truncated: false };
    }
  }
  const preview = serialized.slice(0, Math.max(64, maxBytes - 48));
  return {
    value: `${preview}... [truncated ${Buffer.byteLength(serialized, 'utf8')}B -> ${maxBytes}B]`,
    truncated: true,
  };
};

const stripTs = (wrappedSource: string, language: 'ts' | 'js'): string => {
  if (language === 'js') return wrappedSource;
  const stripper = (
    nodeModule as unknown as {
      stripTypeScriptTypes?: (code: string, options?: { mode?: 'strip' | 'transform' }) => string;
    }
  ).stripTypeScriptTypes;
  if (typeof stripper !== 'function') {
    return wrappedSource;
  }
  return stripper(wrappedSource, { mode: 'strip' });
};

const formatConsoleArgs = (args: unknown[]): string =>
  args
    .map(arg => (typeof arg === 'string' ? arg : safeStringify(arg)))
    .join(' ');

const createAbortableSleep = (
  deadlineMs: number,
  signal?: AbortSignal
): ((ms: number) => Promise<void>) => {
  return (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('PTC script aborted.'));
        return;
      }
      const requested = typeof ms === 'number' && Number.isFinite(ms) ? Math.max(0, Math.trunc(ms)) : 0;
      const remaining = Math.max(0, deadlineMs - Date.now());
      const bounded = Math.min(requested, remaining);
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, bounded);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('PTC script aborted.'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
};

export const runPtcScript = async (
  params: {
    code: string;
    language?: 'ts' | 'js';
    timeoutMs?: number;
  },
  deps: PtcExecutionDeps
): Promise<PtcExecutionResult> => {
  const startedAt = Date.now();
  const settings = resolvePtcToolSettings(deps.settings);

  if (!settings.enabled) {
    return {
      ok: false,
      error: 'PTC tool is disabled in [tools.ptc] settings.',
      logs: [],
      toolCalls: [],
      toolCallCount: 0,
      durationMs: 0,
      truncated: false,
    };
  }

  const codeBytes = Buffer.byteLength(params.code, 'utf8');
  if (codeBytes > settings.maxCodeBytes) {
    return {
      ok: false,
      error: `PTC script exceeds maxCodeBytes (${codeBytes} > ${settings.maxCodeBytes}).`,
      logs: [],
      toolCalls: [],
      toolCallCount: 0,
      durationMs: 0,
      truncated: false,
    };
  }

  const timeoutMs = Math.min(
    Math.max(100, Math.trunc(params.timeoutMs ?? settings.defaultTimeoutMs)),
    settings.maxTimeoutMs
  );
  const deadlineMs = startedAt + timeoutMs;
  const language: 'ts' | 'js' = params.language ?? 'ts';

  const logs: string[] = [];
  let logBytes = 0;
  let logsTruncated = false;
  const appendLog = (level: string, args: unknown[]) => {
    if (logs.length >= settings.maxLogLines || logBytes >= settings.maxOutputBytes) {
      logsTruncated = true;
      return;
    }
    const prefix = level === 'log' ? '' : `[${level}] `;
    const line = `${prefix}${formatConsoleArgs(args)}`;
    const nextBytes = Buffer.byteLength(line, 'utf8');
    if (logBytes + nextBytes > settings.maxOutputBytes) {
      const slice = line.slice(0, Math.max(32, settings.maxOutputBytes - logBytes));
      logs.push(`${slice}...`);
      logBytes = settings.maxOutputBytes;
      logsTruncated = true;
      return;
    }
    logs.push(line);
    logBytes += nextBytes;
  };

  const sandboxConsole = Object.freeze({
    log: (...args: unknown[]) => appendLog('log', args),
    info: (...args: unknown[]) => appendLog('info', args),
    warn: (...args: unknown[]) => appendLog('warn', args),
    error: (...args: unknown[]) => appendLog('error', args),
  });

  const toolCalls: PtcToolCallTrace[] = [];
  let timedOut = false;

  const callToolChecked = async (toolName: string, args: unknown = {}): Promise<unknown> => {
    deps.signal?.throwIfAborted();
    if (timedOut || Date.now() > deadlineMs) {
      throw new Error(`PTC script timed out after ${timeoutMs}ms.`);
    }
    const normalized = typeof toolName === 'string' ? toolName.trim() : '';
    if (!normalized) {
      throw new Error('Tool name must be a non-empty string.');
    }
    if (normalized === 'ptc') {
      throw new Error('Recursive `ptc` calls are not permitted.');
    }
    if (toolCalls.length >= settings.maxToolCalls) {
      throw new Error(
        `PTC script exceeded maxToolCalls limit (${settings.maxToolCalls}).`
      );
    }

    const callStart = Date.now();
    try {
      const output = await deps.invokeTool(normalized, args);
      toolCalls.push({
        name: normalized,
        durationMs: Math.max(0, Date.now() - callStart),
        ok: true,
      });
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toolCalls.push({
        name: normalized,
        durationMs: Math.max(0, Date.now() - callStart),
        ok: false,
        error: message,
      });
      throw error;
    }
  };

  const toolsBase = {
    list: () =>
      deps
        .listTools()
        .filter(t => t.name !== 'ptc')
        .map(t => ({
          name: t.name,
          description: t.description,
          ...(t.source ? { source: t.source } : {}),
          ...(t.parameters !== undefined ? { parameters: t.parameters } : {}),
        })),
    call: (name: string, args?: unknown) => callToolChecked(name, args ?? {}),
  };

  const toolsProxy = new Proxy(toolsBase, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      if (prop === 'then' || prop === 'toJSON' || prop === 'constructor' || prop === '__proto__') {
        return undefined;
      }
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      return (args?: unknown) => callToolChecked(prop, args ?? {});
    },
  });

  const callMcpChecked = async (
    serverRef: string,
    toolRef: string,
    args: unknown = {}
  ): Promise<unknown> => {
    deps.signal?.throwIfAborted();
    if (timedOut || Date.now() > deadlineMs) {
      throw new Error(`PTC script timed out after ${timeoutMs}ms.`);
    }
    const serverName = typeof serverRef === 'string' ? serverRef.trim() : '';
    const toolName = typeof toolRef === 'string' ? toolRef.trim() : '';
    if (!serverName || !toolName) {
      throw new Error('MCP server and tool names must be non-empty strings.');
    }
    if (toolCalls.length >= settings.maxToolCalls) {
      throw new Error(`PTC script exceeded maxToolCalls limit (${settings.maxToolCalls}).`);
    }
    if (!deps.invokeMcpTool) {
      throw new Error(`MCP server "${serverName}" is not configured in this PTC session.`);
    }

    const traceName = `mcp.${serverName}.${toolName}`;
    const callStart = Date.now();
    try {
      const output = await deps.invokeMcpTool(serverName, toolName, args);
      toolCalls.push({
        name: traceName,
        durationMs: Math.max(0, Date.now() - callStart),
        ok: true,
      });
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toolCalls.push({
        name: traceName,
        durationMs: Math.max(0, Date.now() - callStart),
        ok: false,
        error: message,
      });
      throw error;
    }
  };

  const getMcpServers = (): PtcMcpServerDescriptor[] => deps.listMcpServers?.() ?? [];

  const mcpBase = {
    servers: () =>
      getMcpServers().map(s => ({
        name: s.safeName,
        label: s.name,
        toolCount: s.tools.length,
        tools: s.tools.map(t => t.safeName),
      })),
    describe: (server?: string, tool?: string) =>
      renderMcpNamespaceDts(getMcpServers(), {
        ...(server ? { server } : {}),
        ...(tool ? { tool } : {}),
      }),
    call: (server: string, tool: string, args?: unknown) =>
      callMcpChecked(server, tool, args ?? {}),
  };

  const createMcpServerProxy = (serverRef: string) =>
    new Proxy(Object.create(null) as Record<string, unknown>, {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'then' || prop === 'toJSON' || prop === 'constructor' || prop === '__proto__') {
          return undefined;
        }
        return (args?: unknown) => callMcpChecked(serverRef, prop, args ?? {});
      },
    });

  const mcpProxy = new Proxy(mcpBase, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      if (prop === 'then' || prop === 'toJSON' || prop === 'constructor' || prop === '__proto__') {
        return undefined;
      }
      if (prop in target) return Reflect.get(target, prop, receiver);
      return createMcpServerProxy(prop);
    },
  });

  const wrappedSource = [
    'async function __iki_ptc_main__(tools, mcp, workspace, console, sleep) {',
    params.code,
    '}',
  ].join('\n');

  let runnableSource: string;
  try {
    runnableSource = `${stripTs(wrappedSource, language)}\n__iki_ptc_main__;`;
  } catch (error) {
    return {
      ok: false,
      error: `Failed to parse ${language.toUpperCase()} script: ${error instanceof Error ? error.message : String(error)}`,
      logs,
      toolCalls,
      toolCallCount: toolCalls.length,
      durationMs: Math.max(0, Date.now() - startedAt),
      truncated: logsTruncated,
    };
  }

  const sandboxGlobals = {
    console: sandboxConsole,
    tools: toolsProxy,
    mcp: mcpProxy,
    workspace: deps.workspace,
    sleep: createAbortableSleep(deadlineMs, deps.signal),
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Buffer,
    structuredClone,
  };
  const context = vm.createContext(sandboxGlobals, {
    codeGeneration: { strings: false, wasm: false },
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const compiledFn = vm.runInContext(runnableSource, context, {
      filename: `iki-ptc.${language}`,
      timeout: Math.min(timeoutMs, 10_000),
    }) as (
      tools: typeof toolsProxy,
      mcp: typeof mcpProxy,
      workspace: string | null,
      console: typeof sandboxConsole,
      sleep: (ms: number) => Promise<void>
    ) => Promise<unknown>;

    const execPromise = Promise.resolve().then(() =>
      compiledFn(toolsProxy, mcpProxy, deps.workspace, sandboxConsole, sandboxGlobals.sleep)
    );

    const racePromises: Array<Promise<unknown>> = [
      execPromise,
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          reject(new Error(`PTC script timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ];

    if (deps.signal) {
      racePromises.push(
        new Promise<never>((_resolve, reject) => {
          if (deps.signal?.aborted) {
            reject(new Error('PTC script aborted.'));
            return;
          }
          deps.signal?.addEventListener(
            'abort',
            () => reject(new Error('PTC script aborted.')),
            { once: true }
          );
        })
      );
    }

    const rawResult = await Promise.race(racePromises);
    const bounded = boundJsonValue(rawResult, settings.maxOutputBytes);
    return {
      ok: true,
      result: bounded.value,
      logs,
      toolCalls,
      toolCallCount: toolCalls.length,
      durationMs: Math.max(0, Date.now() - startedAt),
      truncated: logsTruncated || bounded.truncated,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      logs,
      toolCalls,
      toolCallCount: toolCalls.length,
      durationMs: Math.max(0, Date.now() - startedAt),
      truncated: logsTruncated,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};
