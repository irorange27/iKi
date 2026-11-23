/**
 * Model / provider domain contract.
 *
 * Follows pi's `coding-agent/src/core/model-config.ts`: one schema is the
 * single source of truth, the TypeScript types are static projections of it
 * (`z.infer`), and one load produces a validated, immutable snapshot. A
 * provider is a declaration, not a database row; the file is its schema.
 *
 * Nothing here knows about Electron, IPC, collections, or the settings UI.
 */
import { z } from 'zod';

/** Recursive JSON value, as a schema so derived types keep their shape. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);

/** Per-model capability metadata, keyed by model id in a provider declaration. */
export const ProviderModelOptionsSchema = z.object({
  displayName: z.string().optional(),
  contextWindow: z.number().nullable().optional(),
  maxInputTokens: z.number().nullable().optional(),
  maxOutputTokens: z.number().nullable().optional(),
  supportsToolCalls: z.boolean().nullable().optional(),
  supportsReasoning: z.boolean().nullable().optional(),
  supportsVision: z.boolean().nullable().optional(),
  supportsEmbeddings: z.boolean().nullable().optional(),
  supportsStructuredOutputs: z.boolean().nullable().optional(),
  providerOptions: z.record(z.string(), JsonValueSchema).nullable().optional(),
});
export type ProviderModelOptions = z.infer<typeof ProviderModelOptionsSchema>;

export const ProviderModelOptionsMapSchema = z.record(z.string(), ProviderModelOptionsSchema);
export type ProviderModelOptionsMap = z.infer<typeof ProviderModelOptionsMapSchema>;

/**
 * A model as a domain object: an id plus its capability overrides.
 * pi's `ModelDefinition`; iKi stores models as ids and keeps overrides in a
 * map, so this is the composed view rather than the on-disk shape.
 */
export const ModelDefinitionSchema = z.object({
  id: z.string().min(1),
  ...ProviderModelOptionsSchema.shape,
});
export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>;

/** An override applied on top of a catalog/built-in model (pi's `ModelOverride`). */
export const ModelOverrideSchema = ProviderModelOptionsSchema.extend({});
export type ModelOverride = z.infer<typeof ModelOverrideSchema>;

/** What lives on disk under one provider id (pi's `ProviderConfig`). */
export const ProviderConfigSchema = z.object({
  name: z.string(),
  type: z.string(),
  apiKey: z.string(),
  baseUrl: z.string(),
  enabled: z.boolean(),
  models: z.array(z.string()),
  availableModels: z.array(z.string()),
  modelOptions: ProviderModelOptionsMapSchema.default({}),
  isResponseApi: z.boolean().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/**
 * The runtime domain object: a declaration plus its identity. pi composes its
 * catalog the same way — the map key becomes the provider's id.
 */
export const ProviderSchema = ProviderConfigSchema.extend({ id: z.string().min(1) });
export type Provider = z.infer<typeof ProviderSchema>;

/** The whole `models.toml` document (pi's `ModelsConfig`). */
export const ModelsConfigSchema = z.object({
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
});
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

/**
 * The single load entry point: validate the whole document once, then hand out
 * an immutable snapshot. Callers never read the file ad hoc (pi's
 * `ModelConfig.load`). An absent document is an empty config; a malformed one
 * is an error — silently treating a broken declaration as "no providers" is
 * exactly how a saved provider becomes unusable.
 */
export const loadModelsConfig = (raw: unknown): ModelsConfig => {
  if (raw === undefined || raw === null) return deepFreeze({ providers: {} });
  return deepFreeze(ModelsConfigSchema.parse(raw));
};

/** Rehydrate one declaration into the runtime domain object. */
export const toProvider = (id: string, config: ProviderConfig): Provider => ({ id, ...config });
