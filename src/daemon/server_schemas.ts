import { z } from 'zod';

import { getDefaultAllowedTools } from './tool_access';
import type { ChatInvocationOptions } from '../shared/types/electron_api';
import type { McpServerInput } from '../shared/types/mcp';

const DEFAULT_SCOPES = [
  'chat:read',
  'chat:write',
  'memory:read',
  'memory:write',
  'tools:run',
  'tools:approve',
  'mcp:read',
  'mcp:write',
];

const NonEmptyTrimmedStringSchema = z.string().trim().min(1);
const OptionalNullableTrimmedStringSchema = z.preprocess(
  value => (typeof value === 'string' ? value.trim() : value),
  z.union([z.string().min(1), z.null()]).optional()
);
const StringArraySchema = z.array(NonEmptyTrimmedStringSchema);
const NullableStringArraySchema = z.union([StringArraySchema, z.null()]).optional();
const NullableStringRecordSchema = z
  .union([z.record(NonEmptyTrimmedStringSchema, z.string()), z.null()])
  .optional();
const LooseObjectSchema = z.object({}).passthrough();

const McpServerBaseSchema = z.object({
  name: NonEmptyTrimmedStringSchema,
  transport: z.enum(['stdio', 'streamable-http', 'sse']),
  command: OptionalNullableTrimmedStringSchema,
  args: NullableStringArraySchema,
  cwd: OptionalNullableTrimmedStringSchema,
  env: NullableStringRecordSchema,
  base_url: OptionalNullableTrimmedStringSchema,
  headers: NullableStringRecordSchema,
  auth_ref: OptionalNullableTrimmedStringSchema,
  enabled: z.boolean().optional(),
  tool_allowlist: NullableStringArraySchema,
  approval_mode: z.enum(['always', 'safe-only', 'never']).nullable().optional(),
});

const McpServerCreateSchema = McpServerBaseSchema.superRefine((value, context) => {
  if (value.transport === 'stdio' && !value.command) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['command'],
      message: 'command is required for stdio servers',
    });
  }

  if (value.transport !== 'stdio' && !value.base_url) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['base_url'],
      message: 'base_url is required for remote servers',
    });
  }
});

const McpServerUpdateSchema = McpServerBaseSchema.partial().refine(
  value => Object.keys(value).length > 0,
  {
    message: 'payload must include at least one updatable field',
  }
);

const ClientRegistrationPayloadSchema = z
  .object({
    name: NonEmptyTrimmedStringSchema.optional(),
    scopes: StringArraySchema.optional(),
    allowed_tools: StringArraySchema.optional(),
  })
  .passthrough()
  .transform(value => ({
    name: value.name ?? 'iKi Client',
    scopes: value.scopes ?? DEFAULT_SCOPES,
    allowedTools: value.allowed_tools ?? getDefaultAllowedTools(),
  }));

const ChatThreadCreatePayloadSchema = z
  .object({
    title: z.string().optional(),
    model: z.string().optional(),
  })
  .passthrough();

const ChatSendPayloadSchema = z
  .object({
    providerType: NonEmptyTrimmedStringSchema,
    model: NonEmptyTrimmedStringSchema,
    messages: z.array(z.unknown()).default([]),
    thread_id: NonEmptyTrimmedStringSchema.optional(),
    tools: z.unknown().optional(),
    mcpServerIds: z.unknown().optional(),
    skillIds: StringArraySchema.optional(),
    skillMode: z.enum(['manual', 'auto']).optional(),
  })
  .passthrough()
  .transform(value => ({
    providerType: value.providerType,
    model: value.model,
    messages: value.messages,
    threadId: value.thread_id,
    tools: value.tools,
    mcpServerIds: value.mcpServerIds,
    skillIds: value.skillIds,
    skillMode: value.skillMode as ChatInvocationOptions['skillMode'],
  }));

const ApproveToolPayloadSchema = z
  .object({
    approval_id: NonEmptyTrimmedStringSchema,
    approved: z.boolean(),
    connection_id: z.number().int().positive().optional(),
  })
  .passthrough()
  .transform(value => ({
    approvalId: value.approval_id,
    approved: value.approved,
    connectionId: value.connection_id,
  }));

const MemorySearchPayloadSchema = z
  .object({
    query: NonEmptyTrimmedStringSchema,
    limit: z.number().int().positive().optional(),
    threshold: z.number().optional(),
    include_incognito: z.boolean().default(false),
  })
  .passthrough()
  .transform(value => ({
    query: value.query,
    limit: value.limit,
    threshold: value.threshold,
    includeIncognito: value.include_incognito,
  }));

const WebSocketStartMessageSchema = z
  .object({
    type: z.literal('start'),
    request_id: z.unknown().optional(),
    payload: ChatSendPayloadSchema,
  })
  .passthrough();

const WebSocketApproveToolMessageSchema = z
  .object({
    type: z.literal('approve-tool'),
    approval_id: NonEmptyTrimmedStringSchema,
    approved: z.boolean(),
  })
  .passthrough();

const WebSocketStopMessageSchema = z
  .object({
    type: z.literal('stop'),
  })
  .passthrough();

const DaemonWebSocketMessageSchema = z.discriminatedUnion('type', [
  WebSocketStartMessageSchema,
  WebSocketApproveToolMessageSchema,
  WebSocketStopMessageSchema,
]);

export type ClientRegistrationPayload = z.infer<typeof ClientRegistrationPayloadSchema>;
export type ChatThreadCreatePayload = z.infer<typeof ChatThreadCreatePayloadSchema>;
export type ChatSendPayload = z.infer<typeof ChatSendPayloadSchema>;
export type ApproveToolPayload = z.infer<typeof ApproveToolPayloadSchema>;
export type MemorySearchPayload = z.infer<typeof MemorySearchPayloadSchema>;
export type DaemonWebSocketMessage = z.infer<typeof DaemonWebSocketMessageSchema>;

export const formatSchemaError = (error: z.ZodError): string =>
  error.issues
    .map(issue => {
      const prefix = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      return `${prefix}${issue.message}`;
    })
    .join('; ');

export const getSchemaErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof z.ZodError) {
    return formatSchemaError(error);
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};

export const parseClientRegistrationPayload = (value: unknown): ClientRegistrationPayload =>
  ClientRegistrationPayloadSchema.parse(value);

export const parseChatThreadCreatePayload = (value: unknown): ChatThreadCreatePayload =>
  ChatThreadCreatePayloadSchema.parse(value);

export const parseChatSendPayload = (value: unknown): ChatSendPayload =>
  ChatSendPayloadSchema.parse(value);

export const parseApproveToolPayload = (value: unknown): ApproveToolPayload =>
  ApproveToolPayloadSchema.parse(value);

export const parseMemorySearchPayload = (value: unknown): MemorySearchPayload =>
  MemorySearchPayloadSchema.parse(value);

export const parseMcpServerCreatePayload = (value: unknown): McpServerInput =>
  McpServerCreateSchema.parse(value);

export const parseMcpServerUpdatePayload = (value: unknown): Partial<McpServerInput> =>
  McpServerUpdateSchema.parse(value);

export const parseDaemonWebSocketMessage = (value: unknown): DaemonWebSocketMessage =>
  DaemonWebSocketMessageSchema.parse(value);

export const parseDaemonJsonObject = (value: unknown): Record<string, unknown> =>
  LooseObjectSchema.parse(value);
