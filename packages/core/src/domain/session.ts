/**
 * Session domain contract.
 *
 * Follows pi's `coding-agent/src/core/session-manager.ts`: one schema is the
 * single source of truth, the TypeScript types are static projections of it
 * (`z.infer`), and one load produces a validated, immutable snapshot. A session
 * is an append-only tree of entries stored as JSONL; the schema is its contract,
 * not a UI view or a database row.
 *
 * iKi keeps the same event-sourcing semantics: every entry carries pi's
 * provenance fields (`id`, `parentId`, `timestamp`) and a `type` discriminant,
 * so the discriminated union below is the on-disk shape.
 *
 * This is a leaf contract: it knows nothing about Electron, IPC, the store, or
 * the provider SDKs. Opaque payloads (pi's `AgentMessage`, `Usage`,
 * `SystemMessage`, content blocks) are validated as JSON envelopes here — their
 * concrete shapes belong to the runtime layer, not to this file.
 */
import { z } from 'zod';

/** Recursive JSON value for opaque, provider-owned payloads (the same helper
 *  `domain/models.ts` uses; kept local so this file imports nothing but zod). */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

/** An opaque JSON object: pi's `AgentMessage` / `Usage` / `SystemMessage`. */
const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

/** The `{ provider, modelId }` reference pi threads through session context. */
const ModelRefSchema = z.object({ provider: z.string(), modelId: z.string() });

/** pi's `CURRENT_SESSION_VERSION` — the header version this contract reads. */
export const CURRENT_SESSION_VERSION = 3;

/** First line of a session file. `version` is absent on pi's v1 sessions. */
export const SessionHeaderSchema = z.object({
  type: z.literal('session'),
  version: z.number().optional(),
  id: z.string(),
  timestamp: z.string(),
  cwd: z.string(),
  parentSession: z.string().optional(),
});
export type SessionHeader = z.infer<typeof SessionHeaderSchema>;

/** pi's `NewSessionOptions`: optional id and fork parent for a new session. */
export const NewSessionOptionsSchema = z.object({
  id: z.string().optional(),
  parentSession: z.string().optional(),
});
export type NewSessionOptions = z.infer<typeof NewSessionOptionsSchema>;

/** Shared provenance for every entry: tree link (`id`/`parentId`) + time. */
export const SessionEntryBaseSchema = z.object({
  type: z.string(),
  id: z.string(),
  parentId: z.string().nullable(),
  timestamp: z.string(),
});
export type SessionEntryBase = z.infer<typeof SessionEntryBaseSchema>;

/** A real agent message. `message` is an opaque JSON envelope at this leaf. */
export const SessionMessageEntrySchema = SessionEntryBaseSchema.extend({
  type: z.literal('message'),
  message: JsonObjectSchema,
});
export type SessionMessageEntry = z.infer<typeof SessionMessageEntrySchema>;

/** A change of the active model. */
export const ModelChangeEntrySchema = SessionEntryBaseSchema.extend({
  type: z.literal('model_change'),
  provider: z.string(),
  modelId: z.string(),
});
export type ModelChangeEntry = z.infer<typeof ModelChangeEntrySchema>;

/** A change of reasoning/thinking level. */
export const ThinkingLevelChangeEntrySchema = SessionEntryBaseSchema.extend({
  type: z.literal('thinking_level_change'),
  thinkingLevel: z.string(),
});
export type ThinkingLevelChangeEntry = z.infer<typeof ThinkingLevelChangeEntrySchema>;

/** A compaction checkpoint: summary + the first entry id kept after it. */
export const CompactionEntrySchema = SessionEntryBaseSchema.extend({
  type: z.literal('compaction'),
  summary: z.string(),
  firstKeptEntryId: z.string(),
  tokensBefore: z.number(),
  details: JsonValueSchema.optional(),
  usage: JsonObjectSchema.optional(),
  fromHook: z.boolean().optional(),
  systemMessage: JsonObjectSchema.optional(),
});
export type CompactionEntry = z.infer<typeof CompactionEntrySchema>;

/** Summary of an abandoned branch when forking from an earlier leaf. */
export const BranchSummaryEntrySchema = SessionEntryBaseSchema.extend({
  type: z.literal('branch_summary'),
  fromId: z.string(),
  summary: z.string(),
  details: JsonValueSchema.optional(),
  usage: JsonObjectSchema.optional(),
  fromHook: z.boolean().optional(),
});
export type BranchSummaryEntry = z.infer<typeof BranchSummaryEntrySchema>;

/** Extension-owned state that does NOT participate in LLM context. */
export const CustomEntrySchema = SessionEntryBaseSchema.extend({
  type: z.literal('custom'),
  customType: z.string(),
  data: JsonValueSchema.optional(),
});
export type CustomEntry = z.infer<typeof CustomEntrySchema>;

/** Extension-owned message that DOES participate in LLM context. */
export const CustomMessageEntrySchema = SessionEntryBaseSchema.extend({
  type: z.literal('custom_message'),
  customType: z.string(),
  content: z.union([z.string(), z.array(JsonValueSchema)]),
  details: JsonValueSchema.optional(),
  display: z.boolean(),
});
export type CustomMessageEntry = z.infer<typeof CustomMessageEntrySchema>;

/** User bookmark on an entry; `undefined` clears it (and JSON drops the key). */
export const LabelEntrySchema = SessionEntryBaseSchema.extend({
  type: z.literal('label'),
  targetId: z.string(),
  label: z.string().optional(),
});
export type LabelEntry = z.infer<typeof LabelEntrySchema>;

/** Session metadata (the user-defined display name). */
export const SessionInfoEntrySchema = SessionEntryBaseSchema.extend({
  type: z.literal('session_info'),
  name: z.string().optional(),
});
export type SessionInfoEntry = z.infer<typeof SessionInfoEntrySchema>;

/** pi's `SessionEntry`: all entry kinds distinguished by `type`. */
export const SessionEntrySchema = z.discriminatedUnion('type', [
  SessionMessageEntrySchema,
  ThinkingLevelChangeEntrySchema,
  ModelChangeEntrySchema,
  CompactionEntrySchema,
  BranchSummaryEntrySchema,
  CustomEntrySchema,
  CustomMessageEntrySchema,
  LabelEntrySchema,
  SessionInfoEntrySchema,
]);
export type SessionEntry = z.infer<typeof SessionEntrySchema>;

/** The resolved model context: messages + active settings for one branch. */
export const SessionContextSchema = z.object({
  messages: z.array(JsonObjectSchema),
  thinkingLevel: z.string(),
  model: ModelRefSchema.nullable(),
});
export type SessionContext = z.infer<typeof SessionContextSchema>;

/** Metadata for a session on disk (pi builds this in memory, not from JSONL). */
export const SessionInfoSchema = z.object({
  path: z.string(),
  id: z.string(),
  cwd: z.string(),
  name: z.string().optional(),
  parentSessionPath: z.string().optional(),
  created: z.date(),
  modified: z.date(),
  messageCount: z.number(),
  firstMessage: z.string(),
  allMessagesText: z.string(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

/** Provenance-preserving projection: per-entry messages plus the flat view. */
export const SessionProjectionSchema = z.object({
  entries: z.array(
    z.object({
      sourceEntry: SessionEntrySchema,
      messages: z.array(JsonObjectSchema),
    }),
  ),
  messages: z.array(JsonObjectSchema),
  thinkingLevel: z.string(),
  model: ModelRefSchema.nullable(),
});
export type SessionProjection = z.infer<typeof SessionProjectionSchema>;

/** pi's `SessionTreeNode`. Recursive: the non-recursive fields come from
 *  `z.infer`, and `children` closes the loop — the same shape split
 *  `models.ts` uses for its recursive `JsonValue` helper. */
const SessionTreeNodeCoreSchema = z.object({
  entry: SessionEntrySchema,
  label: z.string().optional(),
  labelTimestamp: z.string().optional(),
});
export type SessionTreeNode = z.infer<typeof SessionTreeNodeCoreSchema> & {
  children: SessionTreeNode[];
};
export const SessionTreeNodeSchema: z.ZodType<SessionTreeNode> = z.lazy(() =>
  SessionTreeNodeCoreSchema.extend({ children: z.array(SessionTreeNodeSchema) }),
);

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

const SessionEntriesSchema = z.array(SessionEntrySchema);

/**
 * The single load entry point. `raw` is untrusted: either the JSONL text of a
 * session file (one entry per line, as pi and iKi both store it) or an
 * already-parsed array of entries. The `session` header line is dropped — pi's
 * `SessionManager.getEntries()` does the same — and every remaining entry is
 * validated against the discriminated union before being handed back frozen.
 * A malformed entry is an error, never a silently shortened session.
 */
export const parseSessionEntries = (raw: unknown): SessionEntry[] => {
  let lines: unknown[];
  if (typeof raw === 'string') {
    lines = raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);
  } else if (Array.isArray(raw)) {
    lines = raw;
  } else {
    throw new TypeError('parseSessionEntries expects a JSONL string or an array of entries');
  }
  const entries = lines.filter(
    (line) =>
      !(
        typeof line === 'object' &&
        line !== null &&
        (line as { type?: unknown }).type === 'session'
      ),
  );
  return deepFreeze(SessionEntriesSchema.parse(entries));
};
