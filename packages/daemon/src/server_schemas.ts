import { z } from 'zod';

import { getDefaultAllowedTools } from './tool_access';
import type { ChatInvocationOptions } from '@iki/backend/types/chat_invocation';
import type { McpServerInput } from '@iki/backend/types/mcp';
import type { ChatExperimentalContext } from '@iki/backend/chat/intervention_policy';
import type { AgentRunKind } from '@iki/backend/types/agent_run';

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
const ExperimentalContextSchema = z
  .object({
    affect_mode: z.enum(['no_affect', 'tone_only', 'explicit_policy']).optional(),
    affectMode: z.enum(['no_affect', 'tone_only', 'explicit_policy']).optional(),
    context_mode: z.enum(['default', 'benchmark_clean']).optional(),
    contextMode: z.enum(['default', 'benchmark_clean']).optional(),
    await_realtime_affect: z.boolean().optional(),
    awaitRealtimeAffect: z.boolean().optional(),
  })
  .passthrough()
  .transform(
    value =>
      ({
        ...(value.affect_mode || value.affectMode
          ? { affectMode: value.affect_mode ?? value.affectMode }
          : {}),
        ...(value.context_mode || value.contextMode
          ? { contextMode: value.context_mode ?? value.contextMode }
          : {}),
        ...(typeof value.await_realtime_affect === 'boolean' ||
        typeof value.awaitRealtimeAffect === 'boolean'
          ? { awaitRealtimeAffect: value.await_realtime_affect ?? value.awaitRealtimeAffect }
          : {}),
      }) satisfies ChatExperimentalContext
  );

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
    maxIterations: z.number().int().positive().max(100).optional(),
    experimental_context: ExperimentalContextSchema.optional(),
    autonomous: z
      .object({
        maxIterations: z.number().int().positive().max(100),
        continuePrompt: z.string().optional(),
      })
      .optional(),
    run_config: z
      .object({
        kind: z.string().optional(),
        parent_run_id: z.string().optional(),
        root_run_id: z.string().optional(),
      })
      .optional(),
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
    maxIterations: value.maxIterations,
    experimentalContext: value.experimental_context,
    autonomous: value.autonomous as
      | { maxIterations: number; continuePrompt?: string }
      | undefined,
    runConfig: value.run_config as
      | { kind?: AgentRunKind; parentRunId?: string; rootRunId?: string }
      | undefined,
  }));

const ChatMessageCreatePayloadSchema = z
  .object({
    thread_id: NonEmptyTrimmedStringSchema,
    role: NonEmptyTrimmedStringSchema,
    content: z.string(),
    timestamp: OptionalNullableTrimmedStringSchema,
    metadata: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    await_emotion_analysis: z.boolean().optional(),
  })
  .passthrough()
  .transform(value => ({
    threadId: value.thread_id,
    role: value.role,
    content: value.content,
    timestamp: value.timestamp,
    metadata: value.metadata,
    awaitEmotionAnalysis: value.await_emotion_analysis === true,
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

const WebSocketSteerMessageSchema = z
  .object({
    type: z.literal('steer'),
    message: NonEmptyTrimmedStringSchema,
    threadId: z.string().optional(),
  })
  .passthrough();

const DaemonWebSocketMessageSchema = z.discriminatedUnion('type', [
  WebSocketStartMessageSchema,
  WebSocketApproveToolMessageSchema,
  WebSocketStopMessageSchema,
  WebSocketSteerMessageSchema,
]);

export type ClientRegistrationPayload = z.infer<typeof ClientRegistrationPayloadSchema>;
export type ChatThreadCreatePayload = z.infer<typeof ChatThreadCreatePayloadSchema>;
export type ChatSendPayload = z.infer<typeof ChatSendPayloadSchema>;
export type ChatMessageCreatePayload = z.infer<typeof ChatMessageCreatePayloadSchema>;
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

export const parseChatMessageCreatePayload = (value: unknown): ChatMessageCreatePayload =>
  ChatMessageCreatePayloadSchema.parse(value);

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
