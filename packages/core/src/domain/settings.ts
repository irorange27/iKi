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
  language: z.enum(['en', 'zh-CN']).catch('en'),
  theme: z.enum(['light', 'dark', 'system']).catch('system'),
  themePresetId: z.string().catch('iki-default'),
  autoUpdate: z.boolean().catch(true),
  minimizeToTray: z.boolean().catch(false),
  closeToTray: z.boolean().catch(false),
  startMinimized: z.boolean().catch(false),
  quickChatHideOnBlur: z.boolean().catch(false),
  autoApproveToolRequests: z.boolean().catch(false),
});
export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;

export const UiSettingsSchema = z.object({
  fontSize: z.number().finite().catch(15),
  density: z.enum(['compact', 'comfortable', 'spacious']).catch('comfortable'),
  chatContentPadding: z.number().finite().catch(24),
  composerPadding: z.number().finite().catch(10),
  messageBubblePaddingX: z.number().finite().catch(16),
  messageBubblePaddingY: z.number().finite().catch(12),
  messageGap: z.number().finite().catch(18),
  companion: z
    .object({
      enabled: z.boolean().catch(true),
      alwaysOnTop: z.boolean().catch(true),
      rememberPosition: z.boolean().catch(true),
      reduceMotion: z.boolean().catch(false),
      openMainWindowOnClick: z.boolean().catch(true),
      position: z
        .object({
          x: z.number().finite().nullable().catch(null),
          y: z.number().finite().nullable().catch(null),
        })
        .prefault({}),
    })
    .prefault({}),
});
export type UiSettings = z.infer<typeof UiSettingsSchema>;

export const NetworkSettingsSchema = z.object({
  proxy: z
    .object({
      enable: z.boolean().catch(false),
      type: z.enum(['http', 'https', 'socks5']).catch('http'),
      host: z.string().catch(''),
      port: z.number().finite().nullable().catch(null),
      username: z.string().optional(),
      password: z.string().optional(),
    })
    .prefault({}),
  webSearch: z
    .object({
      preferredEngine: z.enum(['google', 'duckduckgo', 'bing']).catch('google'),
    })
    .prefault({}),
  timeout: z.number().finite().catch(5000),
  retryAttempts: z.number().finite().catch(3),
});
export type NetworkSettings = z.infer<typeof NetworkSettingsSchema>;

export const SecuritySettingsSchema = z.object({
  encryptApikeys: z.boolean().catch(true),
  requirePassword: z.boolean().catch(false),
  sessionTimeout: z.number().finite().catch(60),
  enableLogging: z.boolean().catch(true),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).catch('info'),
});
export type SecuritySettings = z.infer<typeof SecuritySettingsSchema>;

export const KeybindingsSettingsSchema = z.object({
  sendMessage: z.string().catch('Enter'),
  openSettings: z.string().catch('Cmd+,'),
});
export type KeybindingsSettings = z.infer<typeof KeybindingsSettingsSchema>;

export const ChatSettingsSchema = z.object({
  composer: z
    .object({
      preferredProviderId: z.string().catch(''),
      preferredModel: z.string().catch(''),
    })
    .prefault({}),
});
export type ChatSettings = z.infer<typeof ChatSettingsSchema>;

export const ContextSettingsSchema = z.object({
  enabled: z.boolean().catch(true),
  maxIdentityTokens: z.number().int().nonnegative().catch(320),
  maxSkillTokens: z.number().int().nonnegative().catch(1200),
});
export type ContextSettings = z.infer<typeof ContextSettingsSchema>;

export const SpeechSettingsSchema = z.object({
  enabled: z.boolean().catch(false),
  providerType: z.enum(['openai', 'whisper-node', '']).catch('openai'),
  apiKey: z.string().catch(''),
  baseUrl: z.string().catch(''),
  downloadBaseUrl: z.string().catch(''),
  model: z.string().catch('whisper-1'),
  modelPath: z.string().catch(''),
  language: z.string().catch(''),
  prompt: z.string().catch(''),
});
export type SpeechSettings = z.infer<typeof SpeechSettingsSchema>;

export const ToolModelSettingsSchema = z.object({
  providerId: z.string().catch(''),
  model: z.string().catch(''),
});
export type ToolModelSettings = z.infer<typeof ToolModelSettingsSchema>;

export const ToolExecutionSettingsSchema = z.object({
  shellApprovalMode: z.literal('always').catch('always'),
});
export type ToolExecutionSettings = z.infer<typeof ToolExecutionSettingsSchema>;

export const ShellToolSettingsSchema = z.object({
  defaultTimeoutMs: z.number().int().positive().catch(30000),
  maxTimeoutMs: z.number().int().positive().catch(600000),
  promoteOnTimeout: z.boolean().catch(true),
  maxOutputBytes: z.number().int().positive().catch(24000),
  maxOutputLines: z.number().int().positive().catch(200),
  defaultWaitMs: z.number().int().positive().catch(15000),
  maxWaitMs: z.number().int().positive().catch(120000),
  shellPath: z.string().catch(''),
});
export type ShellToolSettings = z.infer<typeof ShellToolSettingsSchema>;

export const SwarmToolSettingsSchema = z.object({
  maxWorkers: z.number().int().positive().catch(12),
  maxConcurrentActive: z.number().int().positive().catch(4),
  maxTotalTurns: z.number().int().positive().catch(80),
  maxMentionsPerPost: z.number().int().positive().catch(6),
  maxPingPongHops: z.number().int().positive().catch(12),
  isolatedApprovalPolicy: z
    .enum(['never', 'trustWorkspace', 'askRisky', 'always'])
    .catch('trustWorkspace'),
  inheritApprovalPolicy: z
    .enum(['never', 'trustWorkspace', 'askRisky', 'always'])
    .catch('askRisky'),
  inheritReadOnlyTools: z.array(z.string()).catch([]),
  worktreeDirName: z.string().catch('swarm-worktrees'),
  branchPrefix: z.string().catch('iki/swarm'),
});
export type SwarmToolSettings = z.infer<typeof SwarmToolSettingsSchema>;

export const ToolsSettingsSchema = z.object({
  shell: ShellToolSettingsSchema.prefault({}).catch(ShellToolSettingsSchema.parse({})),
  swarm: SwarmToolSettingsSchema.prefault({}).catch(SwarmToolSettingsSchema.parse({})),
});
export type ToolsSettings = z.infer<typeof ToolsSettingsSchema>;

export const McpSettingsSchema = z.object({
  enabled: z.boolean().catch(false),
  connectOnStartup: z.boolean().catch(false),
  allowRemoteServers: z.boolean().catch(false),
  defaultApprovalMode: z.enum(['always', 'safe-only', 'never']).catch('safe-only'),
  requestTimeoutMs: z.number().finite().catch(20000),
  maxConcurrentRequests: z.number().int().nonnegative().catch(4),
});
export type McpSettings = z.infer<typeof McpSettingsSchema>;

/**
 * The iKi settings domain (`AppSettings`): the aggregate that replaces the
 * hand-written `AppConfig` form mirror. Each section carries its defaults
 * twice over — `.prefault({})` feeds an empty object through the leaf
 * `.catch()` chain, and `.catch(parse({}))` absorbs a wholly malformed
 * section (`general: null` from a hand-edited file) exactly as the old
 * per-section mirror did. The `themes` section is intentionally not here:
 * theme presets belong to `@iki/theme` and are added by the app schema.
 */
export const AppSettingsSchema = z.object({
  general: GeneralSettingsSchema.prefault({}).catch(GeneralSettingsSchema.parse({})),
  ui: UiSettingsSchema.prefault({}).catch(UiSettingsSchema.parse({})),
  network: NetworkSettingsSchema.prefault({}).catch(NetworkSettingsSchema.parse({})),
  security: SecuritySettingsSchema.prefault({}).catch(SecuritySettingsSchema.parse({})),
  keybindings: KeybindingsSettingsSchema.prefault({}).catch(KeybindingsSettingsSchema.parse({})),
  chat: ChatSettingsSchema.prefault({}).catch(ChatSettingsSchema.parse({})),
  context: ContextSettingsSchema.prefault({}).catch(ContextSettingsSchema.parse({})),
  speech: SpeechSettingsSchema.prefault({}).catch(SpeechSettingsSchema.parse({})),
  toolModel: ToolModelSettingsSchema.prefault({}).catch(ToolModelSettingsSchema.parse({})),
  toolExecution: ToolExecutionSettingsSchema.prefault({}).catch(
    ToolExecutionSettingsSchema.parse({})
  ),
  tools: ToolsSettingsSchema.prefault({}).catch(ToolsSettingsSchema.parse({})),
  mcp: McpSettingsSchema.prefault({}).catch(McpSettingsSchema.parse({})),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

/**
 * The single runtime entry: validate the whole document once and hand out a
 * fully defaulted snapshot. Missing fields and missing sections are resolved by
 * the `.catch()` declarations above — there is no second defaults table and
 * no per-field `.catch()` chain. A wholly malformed document (not an object)
 * resolves to the same default snapshot instead of throwing into the UI.
 */
export const parseAppSettings = (raw: unknown): AppSettings => {
  const result = AppSettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : AppSettingsSchema.parse({});
};
