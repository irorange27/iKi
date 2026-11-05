/**
 * Tool / extension domain contract.
 *
 * Mirrors pi's `coding-agent/src/core/{tools, extensions}`. One schema is the
 * single source of truth; TypeScript types are its static projection
 * (`z.infer`). A tool is a named, typed capability — not a registry row or a
 * UI card. Callback and provider-owned payload fields stay opaque here; their
 * concrete shapes belong to `@iki/ai` and the tool implementations.
 */
import { z } from 'zod';

export const ToolExecutionModeSchema = z.enum(['sequential', 'parallel']);
export type ToolExecutionMode = z.infer<typeof ToolExecutionModeSchema>;

export const ToolExposureSchema = z.enum(['always', 'on-demand']);
export type ToolExposure = z.infer<typeof ToolExposureSchema>;

export const ToolAnnotationsSchema = z.object({
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
  title: z.string().optional(),
});
export type ToolAnnotations = z.infer<typeof ToolAnnotationsSchema>;

export const ToolInfoSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  exposure: ToolExposureSchema.optional(),
  annotations: ToolAnnotationsSchema.optional(),
});
export type ToolInfo = z.infer<typeof ToolInfoSchema>;

export const ToolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  /** Provider-owned parameter schema (JSON Schema / TypeBox). */
  parameters: z.unknown(),
  execute: z.custom<(args: unknown, context: unknown) => unknown | Promise<unknown>>(),
  annotations: ToolAnnotationsSchema.optional(),
  exposure: ToolExposureSchema.optional(),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const RegisteredToolSchema = ToolDefinitionSchema.extend({
  source: z.string().optional(),
  namespace: z.string().optional(),
});
export type RegisteredTool = z.infer<typeof RegisteredToolSchema>;

export const AgentToolResultSchema = z.object({
  content: z.array(z.unknown()),
  details: z.unknown().optional(),
  isError: z.boolean().optional(),
});
export type AgentToolResult = z.infer<typeof AgentToolResultSchema>;

export const ToolLoadoutSchema = z.object({
  tools: z.array(z.string()),
  mode: ToolExecutionModeSchema.optional(),
});
export type ToolLoadout = z.infer<typeof ToolLoadoutSchema>;

export const ToolRenderResultOptionsSchema = z.object({
  expanded: z.boolean().optional(),
  showDetails: z.boolean().optional(),
});
export type ToolRenderResultOptions = z.infer<typeof ToolRenderResultOptionsSchema>;

/* ---- iKi-specific members of the same domain ---- */

export const ToolRetryConfigSchema = z.object({
  maxRetries: z.number().int().nonnegative(),
  baseDelayMs: z.number().int().nonnegative(),
  maxDelayMs: z.number().int().nonnegative(),
});
export type ToolRetryConfig = z.infer<typeof ToolRetryConfigSchema>;

export const McpServerConfigSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(['stdio', 'sse', 'streamable-http']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const McpExposureSchema = z.enum(['all', 'allowlist', 'none']);
export type McpExposure = z.infer<typeof McpExposureSchema>;

export const SkillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  content: z.string(),
  path: z.string().optional(),
});
export type Skill = z.infer<typeof SkillSchema>;

/* ---- Extension surface (pi `core/extensions`) ---- */

export const ExtensionShortcutSchema = z.object({
  key: z.string(),
  command: z.string(),
});
export type ExtensionShortcut = z.infer<typeof ExtensionShortcutSchema>;

export const ExtensionCommandContextSchema = z.object({
  cwd: z.string(),
  args: z.array(z.string()).optional(),
});
export type ExtensionCommandContext = z.infer<typeof ExtensionCommandContextSchema>;

export const ExtensionToolContextSchema = z.object({
  cwd: z.string(),
  sessionId: z.string().optional(),
});
export type ExtensionToolContext = z.infer<typeof ExtensionToolContextSchema>;

export const ExtensionContextSchema = z.object({
  cwd: z.string(),
  sessionId: z.string().optional(),
});
export type ExtensionContext = z.infer<typeof ExtensionContextSchema>;

export const ExtensionAPISchema = z.object({
  registerTool: z.custom<(tool: ToolDefinition) => void>(),
  registerCommand: z.custom<(name: string, handler: unknown) => void>().optional(),
  on: z.custom<(event: string, handler: unknown) => void>().optional(),
});
export type ExtensionAPI = z.infer<typeof ExtensionAPISchema>;

export const ExtensionSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  init: z.custom<(api: ExtensionAPI, context: ExtensionContext) => void | Promise<void>>().optional(),
});
export type Extension = z.infer<typeof ExtensionSchema>;

export const ExtensionRunnerSchema = z.object({
  extensions: z.array(ExtensionSchema),
  context: ExtensionContextSchema,
});
export type ExtensionRunner = z.infer<typeof ExtensionRunnerSchema>;

/** Runtime entry point: a tool handed across a boundary must satisfy the contract. */
export const parseToolDefinition = (raw: unknown): ToolDefinition =>
  ToolDefinitionSchema.parse(raw);
