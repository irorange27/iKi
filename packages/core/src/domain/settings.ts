/**
 * Settings domain contract.
 *
 * Follows pi's `coding-agent/src/core/settings-manager.ts`: one schema is the
 * single source of truth, the TypeScript types are static projections of it
 * (`z.infer`), and one load produces a fully defaulted snapshot. Defaults live
 * on the fields themselves — there is no parallel defaults table to drift.
 *
 * The settings UI form is not the type — the settings domain is
 * （UI 表单不是类型，设置域才是）. Forms, IPC payloads and persisted JSON are
 * projections of these schemas, never the other way around.
 *
 * Nothing here knows about Electron, IPC, the filesystem, or the settings UI:
 * domain is a leaf contract layer and imports only `zod`.
 */
import { z } from 'zod';

/* pi-aligned SettingsManager family ----------------------------------------- */

/** Cache-warming profile. "idle" also warms between agent runs (pi). */
export const CacheWarmingModeSchema = z.enum(['off', 'streaming', 'idle']);
export type CacheWarmingMode = z.infer<typeof CacheWarmingModeSchema>;

/** `true` hides all startup output; `"header"` keeps only the header (pi). */
export const QuietStartupSchema = z.union([z.boolean(), z.literal('header')]);
export type QuietStartup = z.infer<typeof QuietStartupSchema>;

export const TuiModeSchema = z.enum(['regular', 'fullscreen']);
export type TuiMode = z.infer<typeof TuiModeSchema>;

export const DefaultProjectTrustSchema = z.enum(['ask', 'always', 'never']);
export type DefaultProjectTrust = z.infer<typeof DefaultProjectTrustSchema>;

export const FullscreenExitOutputSchema = z.enum(['transcript', 'resume-hint']);
export type FullscreenExitOutput = z.infer<typeof FullscreenExitOutputSchema>;

/**
 * A package source: the string form loads every resource, the object form
 * filters them (pi's `PackageSource`).
 */
export const PackageSourceSchema = z.union([
  z.string(),
  z.object({
    source: z.string(),
    autoload: z.boolean().optional(),
    extensions: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    prompts: z.array(z.string()).optional(),
    themes: z.array(z.string()).optional(),
  }),
]);
export type PackageSource = z.infer<typeof PackageSourceSchema>;

/** Context compaction — pi's `CompactionSettings`. */
export const CompactionSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  reserveTokens: z.number().int().nonnegative().default(16384),
  keepRecentTokens: z.number().int().nonnegative().default(20000),
  modelOverrides: z
    .record(
      z.string(),
      z.object({
        reserveTokens: z.number().int().nonnegative().optional(),
        keepRecentTokens: z.number().int().nonnegative().optional(),
      })
    )
    .optional(),
});
export type CompactionSettings = z.infer<typeof CompactionSettingsSchema>;

/** Agent/LLM retry policy — pi's `RetrySettings` (legacy `maxDelayMs` omitted). */
export const RetrySettingsSchema = z.object({
  enabled: z.boolean().default(true),
  maxRetries: z.number().int().nonnegative().default(3),
  baseDelayMs: z.number().int().nonnegative().default(2000),
  maxAgentDelayMs: z.number().int().nonnegative().default(60000),
  provider: z
    .object({
      timeoutMs: z.number().int().nonnegative().optional(),
      maxRetries: z.number().int().nonnegative().optional(),
      maxRetryDelayMs: z.number().int().nonnegative().default(60000),
    })
    .prefault({}),
});
export type RetrySettings = z.infer<typeof RetrySettingsSchema>;

/** Image handling — pi's `ImageSettings`. */
export const ImageSettingsSchema = z.object({
  autoResize: z.boolean().default(true),
  blockImages: z.boolean().default(false),
});
export type ImageSettings = z.infer<typeof ImageSettingsSchema>;

/**
 * The pi-aligned agent settings document (`Settings`): the family above plus
 * the core scalars. Fields iKi does not consume yet are deliberately omitted
 * rather than mirrored as a second form.
 */
export const SettingsSchema = z.object({
  $schema: z.string().optional(),
  lastChangelogVersion: z.string().optional(),
  defaultProvider: z.string().optional(),
  defaultModel: z.string().optional(),
  theme: z.string().optional(),
  compaction: CompactionSettingsSchema.prefault({}),
  retry: RetrySettingsSchema.prefault({}),
  images: ImageSettingsSchema.prefault({}),
  packages: z.array(PackageSourceSchema).default([]),
  cacheWarming: CacheWarmingModeSchema.default('streaming'),
  quietStartup: QuietStartupSchema.default(false),
  tuiMode: TuiModeSchema.default('fullscreen'),
  defaultProjectTrust: DefaultProjectTrustSchema.default('ask'),
  fullscreenExitOutput: FullscreenExitOutputSchema.default('transcript'),
  hideThinkingBlock: z.boolean().default(false),
  showCacheMissNotices: z.boolean().default(false),
});
export type Settings = z.infer<typeof SettingsSchema>;

/* iKi GUI sections — field names follow `types/config.ts` ------------------- */

export const GeneralSettingsSchema = z.object({
  language: z.enum(['en', 'zh-CN']).default('en'),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  themePresetId: z.string().default('iki-default'),
  autoUpdate: z.boolean().default(true),
  minimizeToTray: z.boolean().default(false),
  closeToTray: z.boolean().default(false),
  startMinimized: z.boolean().default(false),
  quickChatHideOnBlur: z.boolean().default(false),
  autoApproveToolRequests: z.boolean().default(false),
});
export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;

export const UiSettingsSchema = z.object({
  fontSize: z.number().finite().default(15),
  density: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),
  chatContentPadding: z.number().finite().default(24),
  composerPadding: z.number().finite().default(10),
  messageBubblePaddingX: z.number().finite().default(16),
  messageBubblePaddingY: z.number().finite().default(12),
  messageGap: z.number().finite().default(18),
  companion: z
    .object({
      enabled: z.boolean().default(true),
      alwaysOnTop: z.boolean().default(true),
      rememberPosition: z.boolean().default(true),
      reduceMotion: z.boolean().default(false),
      openMainWindowOnClick: z.boolean().default(true),
      position: z
        .object({
          x: z.number().finite().nullable().default(null),
          y: z.number().finite().nullable().default(null),
        })
        .prefault({}),
    })
    .prefault({}),
});
export type UiSettings = z.infer<typeof UiSettingsSchema>;

export const NetworkSettingsSchema = z.object({
  proxy: z
    .object({
      enable: z.boolean().default(false),
      type: z.enum(['http', 'https', 'socks5']).default('http'),
      host: z.string().default(''),
      port: z.number().finite().nullable().default(null),
      username: z.string().optional(),
      password: z.string().optional(),
    })
    .prefault({}),
  webSearch: z
    .object({
      preferredEngine: z.enum(['google', 'duckduckgo', 'bing']).default('google'),
    })
    .prefault({}),
  timeout: z.number().finite().default(5000),
  retryAttempts: z.number().finite().default(3),
});
export type NetworkSettings = z.infer<typeof NetworkSettingsSchema>;

export const SecuritySettingsSchema = z.object({
  encryptApikeys: z.boolean().default(true),
  requirePassword: z.boolean().default(false),
  sessionTimeout: z.number().finite().default(60),
  enableLogging: z.boolean().default(true),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
export type SecuritySettings = z.infer<typeof SecuritySettingsSchema>;

export const KeybindingsSettingsSchema = z.object({
  sendMessage: z.string().default('Enter'),
  openSettings: z.string().default('Cmd+,'),
});
export type KeybindingsSettings = z.infer<typeof KeybindingsSettingsSchema>;

export const ChatSettingsSchema = z.object({
  composer: z
    .object({
      preferredProviderId: z.string().default(''),
      preferredModel: z.string().default(''),
    })
    .prefault({}),
});
export type ChatSettings = z.infer<typeof ChatSettingsSchema>;

export const ContextSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  maxIdentityTokens: z.number().int().nonnegative().default(320),
  maxSkillTokens: z.number().int().nonnegative().default(1200),
});
export type ContextSettings = z.infer<typeof ContextSettingsSchema>;

export const SpeechSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  providerType: z.enum(['openai', 'whisper-node', '']).default('openai'),
  apiKey: z.string().default(''),
  baseUrl: z.string().default(''),
  downloadBaseUrl: z.string().default(''),
  model: z.string().default('whisper-1'),
  modelPath: z.string().default(''),
  language: z.string().default(''),
  prompt: z.string().default(''),
});
export type SpeechSettings = z.infer<typeof SpeechSettingsSchema>;

export const ToolModelSettingsSchema = z.object({
  providerId: z.string().default(''),
  model: z.string().default(''),
});
export type ToolModelSettings = z.infer<typeof ToolModelSettingsSchema>;

export const ToolExecutionSettingsSchema = z.object({
  shellApprovalMode: z.literal('always').default('always'),
});
export type ToolExecutionSettings = z.infer<typeof ToolExecutionSettingsSchema>;

export const McpSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  connectOnStartup: z.boolean().default(false),
  allowRemoteServers: z.boolean().default(false),
  defaultApprovalMode: z.enum(['always', 'safe-only', 'never']).default('safe-only'),
  requestTimeoutMs: z.number().finite().default(20000),
  maxConcurrentRequests: z.number().int().nonnegative().default(4),
});
export type McpSettings = z.infer<typeof McpSettingsSchema>;

/**
 * The iKi settings domain (`AppSettings`): the aggregate that replaces the
 * hand-written `AppConfig` form mirror. The `themes` section is intentionally
 * not mirrored here — theme presets belong to the separate `@iki/theme`
 * domain, and this contract is a leaf. Unknown keys (including `themes` in old
 * persisted files) are stripped by `z.object` rather than breaking the load.
 */
export const AppSettingsSchema = z.object({
  general: GeneralSettingsSchema.prefault({}),
  ui: UiSettingsSchema.prefault({}),
  network: NetworkSettingsSchema.prefault({}),
  security: SecuritySettingsSchema.prefault({}),
  keybindings: KeybindingsSettingsSchema.prefault({}),
  chat: ChatSettingsSchema.prefault({}),
  context: ContextSettingsSchema.prefault({}),
  speech: SpeechSettingsSchema.prefault({}),
  toolModel: ToolModelSettingsSchema.prefault({}),
  toolExecution: ToolExecutionSettingsSchema.prefault({}),
  mcp: McpSettingsSchema.prefault({}),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

/**
 * The single runtime entry: validate the whole document once and hand out a
 * fully defaulted snapshot. Missing fields and missing sections are resolved by
 * the `.default()` declarations above — there is no second defaults table and
 * no per-field `.catch()` chain. A wholly malformed document (not an object)
 * resolves to the same default snapshot instead of throwing into the UI.
 */
export const parseAppSettings = (raw: unknown): AppSettings => {
  const result = AppSettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : AppSettingsSchema.parse({});
};
