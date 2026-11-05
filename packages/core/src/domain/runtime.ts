/**
 * Model runtime, routing and compaction domain contract.
 *
 * Mirrors pi's `coding-agent/src/core/{model-runtime, virtual-models,
 * compaction}`. One schema is the single source of truth; TypeScript types are
 * its static projection (`z.infer`). Fields whose value is a pi-ai `Model`,
 * `Message`, `Usage` or a callback are typed as `unknown` / `z.custom` here:
 * the domain layer names the contract, the transport types stay in `@iki/ai`.
 */
import { z } from 'zod';

export const ModelThinkingLevelSchema = z.enum([
  'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
]);
export type ModelThinkingLevel = z.infer<typeof ModelThinkingLevelSchema>;

/** Why a request is routed (pi: user / continuation / retry / direct). */
export const ModelRouteReasonSchema = z.enum(['user', 'continuation', 'retry', 'direct']);
export type ModelRouteReason = z.infer<typeof ModelRouteReasonSchema>;

export const VIRTUAL_MODEL_API = 'pi-virtual';
export const VIRTUAL_MODEL_STATE_ENTRY = 'pi.virtual-model-state';

export const VirtualModelStateDataSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
  state: z.unknown(),
});
export type VirtualModelStateData = z.infer<typeof VirtualModelStateDataSchema>;

export const ModelRouteSchema = z.object({
  model: z.unknown(),
  thinkingLevel: ModelThinkingLevelSchema,
  state: z.unknown().optional(),
});
export type ModelRoute = z.infer<typeof ModelRouteSchema>;

export const ModelRouteRequestSchema = z.object({
  reason: ModelRouteReasonSchema,
  thinkingLevel: ModelThinkingLevelSchema,
  messages: z.array(z.unknown()),
  state: z.unknown().optional(),
  previous: z.object({ model: z.unknown(), thinkingLevel: ModelThinkingLevelSchema.optional() }).optional(),
  failed: z.object({ model: z.unknown(), thinkingLevel: ModelThinkingLevelSchema.optional(), message: z.unknown() }).optional(),
});
export type ModelRouteRequest = z.infer<typeof ModelRouteRequestSchema>;

export const VirtualModelDefinitionSchema = z.object({
  provider: z.string(),
  id: z.string().min(1),
  name: z.string(),
  thinkingLevels: z.array(ModelThinkingLevelSchema).optional(),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
  input: z.array(z.enum(['text', 'image'])).optional(),
  route: z.custom<(request: ModelRouteRequest) => ModelRoute | Promise<ModelRoute>>(),
});
export type VirtualModelDefinition = z.infer<typeof VirtualModelDefinitionSchema>;

/** Credential resolution outcome (pi's `ResolvedRequestAuth`). */
export const ResolvedRequestAuthSchema = z.union([
  z.object({
    ok: z.literal(true),
    apiKey: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    baseUrl: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type ResolvedRequestAuth = z.infer<typeof ResolvedRequestAuthSchema>;

export const CredentialSynchronizationOperationSchema = z.enum([
  'login', 'logout', 'setRuntimeApiKey', 'removeRuntimeApiKey',
]);
export type CredentialSynchronizationOperation = z.infer<
  typeof CredentialSynchronizationOperationSchema
>;

export const CreateModelRuntimeOptionsSchema = z.object({
  authPath: z.string().optional(),
  modelsPath: z.string().nullable().optional(),
  modelsStorePath: z.string().optional(),
  allowModelNetwork: z.boolean().optional(),
  modelRefreshTimeoutMs: z.number().optional(),
  catalogBaseUrl: z.string().optional(),
  refreshOnCreate: z.boolean().optional(),
});
export type CreateModelRuntimeOptions = z.infer<typeof CreateModelRuntimeOptionsSchema>;

/* ---- Compaction (pi `core/compaction`) ---- */

export const CompactionSettingsSchema = z.object({
  enabled: z.boolean(),
  reserveTokens: z.number(),
  keepRecentTokens: z.number(),
});
export type CompactionSettings = z.infer<typeof CompactionSettingsSchema>;

export const CompactionResultSchema = z.object({
  summary: z.string(),
  firstKeptEntryId: z.string(),
  tokensBefore: z.number(),
  estimatedTokensAfter: z.number().optional(),
  usage: z.unknown().optional(),
  details: z.unknown().optional(),
});
export type CompactionResult = z.infer<typeof CompactionResultSchema>;

export const CutPointResultSchema = z.object({
  firstKeptEntryIndex: z.number(),
  turnStartIndex: z.number(),
  isSplitTurn: z.boolean(),
});
export type CutPointResult = z.infer<typeof CutPointResultSchema>;

export const BranchSummaryResultSchema = z.object({
  summary: z.string().optional(),
  usage: z.unknown().optional(),
  readFiles: z.array(z.string()).optional(),
  modifiedFiles: z.array(z.string()).optional(),
  aborted: z.boolean().optional(),
  error: z.string().optional(),
});
export type BranchSummaryResult = z.infer<typeof BranchSummaryResultSchema>;

export const BranchPreparationSchema = z.object({
  messages: z.array(z.unknown()),
  fileOps: z.unknown(),
  totalTokens: z.number(),
});
export type BranchPreparation = z.infer<typeof BranchPreparationSchema>;

export const CollectEntriesResultSchema = z.object({
  entries: z.array(z.unknown()),
  commonAncestorId: z.string().nullable(),
});
export type CollectEntriesResult = z.infer<typeof CollectEntriesResultSchema>;

/** Runtime validation entry points — these contracts are usable, not just names. */
export const parseCompactionResult = (raw: unknown): CompactionResult =>
  CompactionResultSchema.parse(raw);
export const parseModelRoute = (raw: unknown): ModelRoute => ModelRouteSchema.parse(raw);
export const parseResolvedRequestAuth = (raw: unknown): ResolvedRequestAuth =>
  ResolvedRequestAuthSchema.parse(raw);
