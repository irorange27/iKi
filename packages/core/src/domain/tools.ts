/**
 * Tool / extension domain contract.
 *
 * Follows pi's `coding-agent/src/core/extensions/types.ts` and `core/tools/index.ts`:
 * one schema is the single source of truth, the TypeScript types are static
 * projections of it (`z.infer`), and even the callable parts of the contract are
 * declared by the schema (`z.custom<(...args) => ...>()`) instead of hand-written
 * interfaces. A `parse*` entry point validates an untrusted declaration once and
 * hands out the typed projection.
 *
 * Nothing here knows about Electron, IPC, the agent runtime, or the settings UI.
 * This is a leaf contract layer: it imports nothing but zod. Opaque runtime
 * handles owned by other modules (a Model, a Message, a Theme, a Component, a
 * session manager, an event bus, ...) are projected as `unknown` / `z.custom` —
 * this layer describes *where* they sit in the contract, not their internals.
 *
 * Corresponds to pi's `core/extensions` + `core/tools` domain, plus the iKi
 * `types/{tool_retry,mcp,skill}.ts` shapes that belong to the same bounded
 * context.
 */
import { z } from 'zod';

// ============================================================================
// Foundations
// ============================================================================

/** Recursive JSON value, as a schema so derived types keep their shape. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);

/**
 * A callable field. Declared by the schema (so the derived type is a real
 * function signature) and validated as a function at runtime — a plain object
 * or a string where a callback is required fails `parse*` instead of silently
 * becoming `unknown`.
 */
const callable = <T>() => z.custom<T>((value) => typeof value === 'function');

/** An opaque runtime handle owned by another module: typed, not introspected. */
const opaque = <T>() => z.custom<T>();

/** A JSON-Schema-like object (pi's TypeBox `TSchema`; here just structured JSON). */
export const SchemaLikeSchema = z.record(z.string(), z.unknown());
export type SchemaLike = z.infer<typeof SchemaLikeSchema>;

/** Provider-side constrained-sampling request for a tool. */
export const ConstrainedSamplingConfigSchema = z.record(z.string(), z.unknown());
export type ConstrainedSamplingConfig = z.infer<typeof ConstrainedSamplingConfigSchema>;

// ============================================================================
// Scalar enums
// ============================================================================

/** Per-tool execution scheduling (pi-agent-core `ToolExecutionMode`). */
export const ToolExecutionModeSchema = z.enum(['sequential', 'parallel']);
export type ToolExecutionMode = z.infer<typeof ToolExecutionModeSchema>;

/** How the model reaches a tool (pi `ToolExposure`). */
export const ToolExposureSchema = z.enum(['direct', 'model-only', 'codemode', 'deferred', 'hidden']);
export type ToolExposure = z.infer<typeof ToolExposureSchema>;

/** Tool result framing (pi `ToolDefinition.renderShell`). */
export const RenderShellSchema = z.enum(['default', 'self']);
export type RenderShell = z.infer<typeof RenderShellSchema>;

/** Extension run mode (pi `ExtensionMode`). */
export const ExtensionModeSchema = z.enum(['tui', 'rpc', 'json', 'print']);
export type ExtensionMode = z.infer<typeof ExtensionModeSchema>;

/** MCP server reachability (pi `McpExposure`). */
export const McpExposureSchema = z.enum(['codemode', 'deferred', 'direct', 'hidden']);
export type McpExposure = z.infer<typeof McpExposureSchema>;

/** iKi MCP transport (from `types/mcp.ts`). */
export const McpTransportSchema = z.enum(['stdio', 'streamable-http', 'sse']);
export type McpTransport = z.infer<typeof McpTransportSchema>;

/** iKi MCP approval mode (from `types/mcp.ts`). */
export const McpApprovalModeSchema = z.enum(['always', 'safe-only', 'never']);
export type McpApprovalMode = z.infer<typeof McpApprovalModeSchema>;

/** iKi skill origin (from `types/skill.ts`). */
export const SkillSourceSchema = z.enum(['user', 'agent']);
export type SkillSource = z.infer<typeof SkillSourceSchema>;

// ============================================================================
// Shared value objects
// ============================================================================

/** Where a tool / extension / skill was loaded from (pi `SourceInfo`). */
export const SourceInfoSchema = z.object({
  path: z.string(),
  source: z.string(),
  scope: z.enum(['user', 'project', 'temporary']),
  origin: z.enum(['package', 'top-level']),
  baseDir: z.string().optional(),
});
export type SourceInfo = z.infer<typeof SourceInfoSchema>;

export const TextContentSchema = z.object({ type: z.literal('text'), text: z.string() });
export type TextContent = z.infer<typeof TextContentSchema>;

export const ImageContentSchema = z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() });
export type ImageContent = z.infer<typeof ImageContentSchema>;

export const ToolResultContentSchema = z.union([TextContentSchema, ImageContentSchema]);
export type ToolResultContent = z.infer<typeof ToolResultContentSchema>;

/** Token usage reported by a tool execution (pi-ai `Usage`, opaque here). */
export const UsageSchema = z.record(z.string(), z.unknown());
export type Usage = z.infer<typeof UsageSchema>;

/** Estimated context-window usage (pi `ContextUsage`). */
export const ContextUsageSchema = z.object({
  tokens: z.number().nullable(),
  contextWindow: z.number(),
  percent: z.number().nullable(),
});
export type ContextUsage = z.infer<typeof ContextUsageSchema>;

/** Options for a compaction request (pi `CompactOptions`). */
export const CompactOptionsSchema = z.object({
  customInstructions: z.string().optional(),
  onComplete: callable<(result: unknown) => void>().optional(),
  onError: callable<(error: Error) => void>().optional(),
});
export type CompactOptions = z.infer<typeof CompactOptionsSchema>;

// ============================================================================
// Rendering options
// ============================================================================

/** Rendering options for tool results (pi `ToolRenderResultOptions`). */
export const ToolRenderResultOptionsSchema = z.object({
  expanded: z.boolean(),
  isPartial: z.boolean(),
});
export type ToolRenderResultOptions = z.infer<typeof ToolRenderResultOptionsSchema>;

// ============================================================================
// Tool annotations / namespace / loadout
// ============================================================================

/** MCP-style hints about what a tool does (pi `ToolAnnotations`). */
export const ToolAnnotationsSchema = z.object({
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
});
export type ToolAnnotations = z.infer<typeof ToolAnnotationsSchema>;

/** A group of related tools, e.g. one MCP server (pi `ToolNamespace`). */
export const ToolNamespaceSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()).optional(),
  description: z.string().optional(),
  instructions: z.string().optional(),
});
export type ToolNamespace = z.infer<typeof ToolNamespaceSchema>;

/** Changes `prepareLoadout` makes to what the model sees (pi `ToolLoadoutChanges`). */
export const ToolLoadoutChangesSchema = z.object({
  descriptions: z.record(z.string(), z.string()).optional(),
  hiddenDeclarations: z.array(z.string()).optional(),
});
export type ToolLoadoutChanges = z.infer<typeof ToolLoadoutChangesSchema>;

// ============================================================================
// Agent tool result & tool runtime objects
// ============================================================================

/** Callback that streams partial execution updates (pi `AgentToolUpdateCallback`). */
export const AgentToolUpdateCallbackSchema = callable<(partialResult: AgentToolResult) => void>();
export type AgentToolUpdateCallback = z.infer<typeof AgentToolUpdateCallbackSchema>;

/** Final or partial result produced by a tool (pi-agent-core `AgentToolResult`). */
export const AgentToolResultSchema = z.object({
  content: z.array(ToolResultContentSchema),
  details: z.unknown(),
  structuredContent: JsonValueSchema.optional(),
  usage: UsageSchema.optional(),
  isError: z.boolean().optional(),
  terminate: z.boolean().optional(),
});
export type AgentToolResult = z.infer<typeof AgentToolResultSchema>;

/** Tool definition as the agent runtime sees it (pi-agent-core `AgentTool`). */
export const AgentToolSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
  parameters: SchemaLikeSchema,
  prepareArguments: callable<(args: unknown) => Record<string, unknown>>().optional(),
  outputSchema: SchemaLikeSchema.optional(),
  execute: callable<
    (
      toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: (partialResult: AgentToolResult) => void
    ) => Promise<AgentToolResult>
  >(),
  replay: z.enum(['never', 'safe']).optional(),
  executionMode: ToolExecutionModeSchema.optional(),
});
export type AgentTool = z.infer<typeof AgentToolSchema>;

/** Final outcome of a tool call after hooks ran (pi `AgentToolCallOutcome`). */
export const AgentToolCallOutcomeSchema = z.object({
  toolCall: z.unknown(),
  result: AgentToolResultSchema,
  isError: z.boolean(),
  durationMs: z.number().optional(),
});
export type AgentToolCallOutcome = z.infer<typeof AgentToolCallOutcomeSchema>;

/** The tools of a session as `prepareLoadout` sees them (pi `ToolLoadout`). */
export const ToolLoadoutSchema = z.object({
  declared: z.array(AgentToolSchema),
  callable: z.array(AgentToolSchema),
  registered: z.array(AgentToolSchema),
  getExposure: callable<(name: string) => ToolExposure>(),
  getNamespace: callable<(name: string) => ToolNamespace | undefined>(),
  getPromptGuidelines: callable<(name: string) => readonly string[]>(),
});
export type ToolLoadout = z.infer<typeof ToolLoadoutSchema>;

// ============================================================================
// Extension contexts
// ============================================================================

/** Context passed to extension event handlers (pi `ExtensionContext`). */
export const ExtensionContextSchema = z.object({
  ui: z.unknown(),
  mode: ExtensionModeSchema,
  hasUI: z.boolean(),
  cwd: z.string(),
  sessionManager: z.unknown(),
  modelRegistry: z.unknown(),
  model: z.unknown(),
  scopedModels: z.array(z.unknown()),
  thinkingLevel: z.string().optional(),
  signal: opaque<AbortSignal | undefined>().optional(),
  isIdle: callable<() => boolean>(),
  isProjectTrusted: callable<() => boolean>(),
  abort: callable<() => void>(),
  hasPendingMessages: callable<() => boolean>(),
  shutdown: callable<() => void>(),
  getContextUsage: callable<() => ContextUsage | undefined>(),
  compact: callable<(options?: CompactOptions) => void>(),
  getSystemPrompt: callable<() => string>(),
});
export type ExtensionContext = z.infer<typeof ExtensionContextSchema>;

/** Extended context for command handlers (pi `ExtensionCommandContext`). */
export const ExtensionCommandContextSchema = ExtensionContextSchema.extend({
  getSystemPromptOptions: callable<() => unknown>(),
  waitForIdle: callable<() => Promise<void>>(),
  newSession: callable<(options?: unknown) => Promise<{ cancelled: boolean }>>(),
  fork: callable<(entryId: string, options?: unknown) => Promise<{ cancelled: boolean }>>(),
  navigateTree: callable<(targetId: string, options?: unknown) => Promise<{ cancelled: boolean }>>(),
  switchSession: callable<(sessionPath: string, options?: unknown) => Promise<{ cancelled: boolean }>>(),
  reload: callable<() => Promise<void>>(),
});
export type ExtensionCommandContext = z.infer<typeof ExtensionCommandContextSchema>;

/** Context passed to a tool's `execute()` (pi `ExtensionToolContext`). */
export const ExtensionToolContextSchema = ExtensionContextSchema.extend({
  tools: z.array(AgentToolSchema),
  executeTool: callable<
    (name: string, args: unknown, options?: unknown) => Promise<AgentToolCallOutcome>
  >(),
});
export type ExtensionToolContext = z.infer<typeof ExtensionToolContextSchema>;

// ============================================================================
// Tool definition / registration / info
// ============================================================================

/**
 * The declaration for `registerTool()` (pi `ToolDefinition`). `execute` is the
 * one required callback; every other function field is an optional hook.
 */
export const ToolDefinitionSchema = z.object({
  name: z.string().min(1),
  label: z.string(),
  description: z.string(),
  promptSnippet: z.string().optional(),
  promptGuidelines: z.array(z.string()).optional(),
  parameters: SchemaLikeSchema,
  constrainedSampling: z.union([z.literal(false), ConstrainedSamplingConfigSchema]).optional(),
  renderShell: RenderShellSchema.optional(),
  prepareArguments: callable<(args: unknown) => Record<string, unknown>>().optional(),
  outputSchema: SchemaLikeSchema.optional(),
  exposure: ToolExposureSchema.optional(),
  namespace: ToolNamespaceSchema.optional(),
  reachesTools: callable<(input: Record<string, unknown>) => 'all' | readonly string[]>().optional(),
  annotations: ToolAnnotationsSchema.optional(),
  defaultActive: z.boolean().optional(),
  prepareLoadout: callable<(loadout: ToolLoadout) => ToolLoadoutChanges | undefined>().optional(),
  executionMode: ToolExecutionModeSchema.optional(),
  execute: callable<
    (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: ((partialResult: AgentToolResult) => void) | undefined,
      ctx: ExtensionToolContext
    ) => Promise<AgentToolResult>
  >(),
  renderCall: callable<(args: Record<string, unknown>, theme: unknown, context: unknown) => unknown>().optional(),
  renderResult: callable<
    (result: AgentToolResult, options: ToolRenderResultOptions, theme: unknown, context: unknown) => unknown
  >().optional(),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

/** A tool plus the source that registered it (pi `RegisteredTool`). */
export const RegisteredToolSchema = z.object({
  definition: ToolDefinitionSchema,
  sourceInfo: SourceInfoSchema,
});
export type RegisteredTool = z.infer<typeof RegisteredToolSchema>;

/** Tool info as `getAllTools()` reports it (pi `ToolInfo`). */
export const ToolInfoSchema = ToolDefinitionSchema.pick({
  name: true,
  description: true,
  parameters: true,
  promptGuidelines: true,
  reachesTools: true,
}).extend({
  exposure: ToolExposureSchema,
  namespace: ToolNamespaceSchema.optional(),
  annotations: ToolAnnotationsSchema.optional(),
  sourceInfo: SourceInfoSchema,
});
export type ToolInfo = z.infer<typeof ToolInfoSchema>;

// ============================================================================
// Registered extension items
// ============================================================================

/** A keyboard shortcut registered by an extension (pi `ExtensionShortcut`). */
export const ExtensionShortcutSchema = z.object({
  shortcut: z.string(),
  description: z.string().optional(),
  handler: callable<(ctx: ExtensionContext) => Promise<void> | void>(),
  extensionPath: z.string(),
});
export type ExtensionShortcut = z.infer<typeof ExtensionShortcutSchema>;

/** A custom slash command (pi `RegisteredCommand`). */
export const RegisteredCommandSchema = z.object({
  name: z.string(),
  sourceInfo: SourceInfoSchema,
  description: z.string().optional(),
  getArgumentCompletions: callable<(argumentPrefix: string) => unknown>().optional(),
  handler: callable<(args: string, ctx: ExtensionCommandContext) => Promise<void>>(),
});
export type RegisteredCommand = z.infer<typeof RegisteredCommandSchema>;

/** A CLI flag registered by an extension (pi `ExtensionFlag`). */
export const ExtensionFlagSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  type: z.enum(['boolean', 'string']),
  default: z.union([z.boolean(), z.string()]).optional(),
  extensionPath: z.string(),
});
export type ExtensionFlag = z.infer<typeof ExtensionFlagSchema>;

/** A loaded extension with all of its registered items (pi `Extension`). */
export const ExtensionSchema = z.object({
  path: z.string(),
  resolvedPath: z.string(),
  hidden: z.boolean().optional(),
  replaceable: z.boolean().optional(),
  sourceInfo: SourceInfoSchema,
  handlers: z.map(z.string(), z.array(callable<(...args: unknown[]) => Promise<unknown>>())),
  tools: z.map(z.string(), RegisteredToolSchema),
  messageRenderers: z.map(z.string(), callable<(...args: unknown[]) => unknown>()),
  toolRenderers: z.array(callable<(...args: unknown[]) => unknown>()).optional(),
  markdownTransformer: callable<(...args: unknown[]) => unknown>().optional(),
  entryRenderers: z.map(z.string(), callable<(...args: unknown[]) => unknown>()).optional(),
  commands: z.map(z.string(), RegisteredCommandSchema),
  flags: z.map(z.string(), ExtensionFlagSchema),
  shortcuts: z.map(z.string(), ExtensionShortcutSchema),
});
export type Extension = z.infer<typeof ExtensionSchema>;

/**
 * The API object handed to an extension factory (pi `ExtensionAPI`). The event
 * subscription and registration methods are the contract surface; foreign
 * runtime values (settings, models, the event bus) stay opaque.
 */
export const ExtensionAPISchema = z.object({
  on: callable<(event: string, handler: (...args: unknown[]) => unknown) => () => void>(),
  registerTool: callable<(tool: ToolDefinition) => void>(),
  registerCommand: callable<(name: string, options: unknown) => void>(),
  registerShortcut: callable<(shortcut: string, options: unknown) => void>(),
  registerFlag: callable<(name: string, options: unknown) => void>(),
  getFlag: callable<(name: string) => boolean | string | undefined>(),
  registerMessageRenderer: callable<(customType: string, renderer: (...args: unknown[]) => unknown) => void>(),
  registerMarkdownTransformer: callable<(transformer: (...args: unknown[]) => unknown) => void>(),
  registerEntryRenderer: callable<(customType: string, renderer: (...args: unknown[]) => unknown) => void>(),
  registerToolRenderer: callable<(resolver: (...args: unknown[]) => unknown) => void>(),
  sendMessage: callable<(message: unknown, options?: unknown) => void>(),
  sendUserMessage: callable<(content: unknown, options?: unknown) => void>(),
  appendEntry: callable<(customType: string, data?: unknown) => void>(),
  setSessionName: callable<(name: string) => void>(),
  getSessionName: callable<() => string | undefined>(),
  setLabel: callable<(entryId: string, label: string | undefined) => void>(),
  exec: callable<(command: string, args: string[], options?: unknown) => Promise<unknown>>(),
  getActiveTools: callable<() => string[]>(),
  getAllTools: callable<() => ToolInfo[]>(),
  getSettings: callable<() => unknown>(),
  setActiveTools: callable<(toolNames: string[]) => void>(),
  getCommands: callable<() => unknown[]>(),
  setModel: callable<(model: unknown) => Promise<boolean>>(),
  getThinkingLevel: callable<() => unknown>(),
  setThinkingLevel: callable<(level: unknown) => void>(),
  registerProvider: callable<(...args: unknown[]) => void>(),
  unregisterProvider: callable<(name: string) => void>(),
  registerMcpServer: callable<(name: string, config: McpServerConfig) => void>(),
  unregisterMcpServer: callable<(name: string) => void>(),
  getMcpServers: callable<() => unknown[]>(),
  registerVirtualModel: callable<(model: unknown) => void>(),
  unregisterVirtualModel: callable<(provider: string, id: string) => void>(),
  events: z.unknown(),
});
export type ExtensionAPI = z.infer<typeof ExtensionAPISchema>;

/**
 * The runtime that drives extensions (pi `ExtensionRunner`, a class in pi).
 * Modeled structurally: its public method surface is the contract.
 */
export const ExtensionRunnerSchema = z.object({
  bindCore: callable<(...args: unknown[]) => void>(),
  bindCommandContext: callable<(actions?: unknown) => void>(),
  setUIContext: callable<(uiContext?: unknown, mode?: ExtensionMode) => void>(),
  getUIContext: callable<() => unknown>(),
  hasUI: callable<() => boolean>(),
  getExtensionPaths: callable<() => string[]>(),
  getAllRegisteredTools: callable<() => RegisteredTool[]>(),
  getToolDefinition: callable<(toolName: string) => ToolDefinition | undefined>(),
  getFlags: callable<() => Map<string, ExtensionFlag>>(),
  setFlagValue: callable<(name: string, value: boolean | string) => void>(),
  getFlagValues: callable<() => Map<string, boolean | string>>(),
  getShortcuts: callable<(resolvedKeybindings: unknown) => Map<string, ExtensionShortcut>>(),
  invalidate: callable<(...args: unknown[]) => void>(),
  onError: callable<(listener: (...args: unknown[]) => unknown) => () => void>(),
  emitError: callable<(error: unknown) => void>(),
  hasHandlers: callable<(eventType: string) => boolean>(),
  getMessageRenderer: callable<(customType: string) => unknown>(),
  getMarkdownTransformers: callable<() => unknown[]>(),
  resolveToolRenderers: callable<(toolName: string, base: () => unknown) => unknown>(),
  getEntryRenderer: callable<(customType: string) => unknown>(),
  getModelRegistry: callable<() => unknown>(),
  getRegisteredCommands: callable<() => unknown[]>(),
  getCommand: callable<(name: string) => unknown>(),
  getActiveTools: callable<() => string[]>(),
  createContext: callable<() => ExtensionContext>(),
  createToolContext: callable<(toolCallId: string, signal: AbortSignal | undefined) => ExtensionToolContext>(),
  createCommandContext: callable<() => ExtensionCommandContext>(),
  shutdown: callable<() => void>(),
});
export type ExtensionRunner = z.infer<typeof ExtensionRunnerSchema>;

// ============================================================================
// iKi-specific shapes in the same bounded context
// ============================================================================

/** Retry policy for a single tool (iKi `types/tool_retry.ts`). */
export const ToolRetryConfigSchema = z.object({
  maxRetries: z.number(),
  backoffMs: z.number().optional(),
  retryableError: callable<(error: unknown) => boolean>().optional(),
  fallback: callable<(lastError: unknown) => unknown | Promise<unknown>>().optional(),
});
export type ToolRetryConfig = z.infer<typeof ToolRetryConfigSchema>;

/**
 * An MCP server declaration (iKi `McpServerInput` from `types/mcp.ts`) composed
 * with pi's MCP exposure knobs. iKi names the record `McpServer`/`McpServerInput`
 * and the approval mode `McpApprovalMode`; the domain name `McpServerConfig`
 * (and `McpExposure`) align with pi.
 */
export const McpServerConfigSchema = z.object({
  name: z.string(),
  transport: McpTransportSchema,
  command: z.string().nullable().optional(),
  args: z.array(z.string()).nullable().optional(),
  cwd: z.string().nullable().optional(),
  env: z.record(z.string(), z.string()).nullable().optional(),
  base_url: z.string().nullable().optional(),
  headers: z.record(z.string(), z.string()).nullable().optional(),
  auth_ref: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  tool_allowlist: z.array(z.string()).nullable().optional(),
  approval_mode: McpApprovalModeSchema.nullable().optional(),
  // pi-style reachability
  exposure: McpExposureSchema.optional(),
  toolExposure: z.record(z.string(), McpExposureSchema).optional(),
  description: z.string().optional(),
  timeout: z.number().optional(),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

/**
 * A skill descriptor (iKi `SkillSummary` from `types/skill.ts`). pi calls the
 * richer loaded record `Skill`; the domain name `Skill` aligns with pi while the
 * field shape stays iKi's on-disk/returned summary.
 */
export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  source: SkillSourceSchema,
  requiredTools: z.array(z.string()).optional(),
  path: z.string().optional(),
});
export type Skill = z.infer<typeof SkillSchema>;

// ============================================================================
// Runtime entry points
// ============================================================================

/**
 * Validate an untrusted tool declaration once and hand out the typed
 * projection. A missing `execute`, or an `execute` that is not a function, is a
 * hard error — exactly the class of malformed declaration that must not be
 * treated as a valid tool.
 */
export const parseToolDefinition = (raw: unknown): ToolDefinition =>
  ToolDefinitionSchema.parse(raw);

export const parseRegisteredTool = (raw: unknown): RegisteredTool =>
  RegisteredToolSchema.parse(raw);

export const parseToolInfo = (raw: unknown): ToolInfo => ToolInfoSchema.parse(raw);

export const parseAgentToolResult = (raw: unknown): AgentToolResult =>
  AgentToolResultSchema.parse(raw);

export const parseToolAnnotations = (raw: unknown): ToolAnnotations =>
  ToolAnnotationsSchema.parse(raw);

export const parseExtensionShortcut = (raw: unknown): ExtensionShortcut =>
  ExtensionShortcutSchema.parse(raw);

export const parseToolRetryConfig = (raw: unknown): ToolRetryConfig =>
  ToolRetryConfigSchema.parse(raw);

export const parseMcpServerConfig = (raw: unknown): McpServerConfig =>
  McpServerConfigSchema.parse(raw);

export const parseSkill = (raw: unknown): Skill => SkillSchema.parse(raw);
