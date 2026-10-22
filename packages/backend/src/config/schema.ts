import { z } from 'zod';
import type { AppConfig } from '../types/config';
import { DEFAULT_APP_CONFIG } from './defaults';
import { Base46ThemePresetInputSchema } from '@iki/theme/base46_schema';
import { normalizeAppLocale } from '@iki/backend/i18n/locale';

const booleanField = (value: boolean) => z.boolean().catch(value);
const numberField = (value: number) => z.number().finite().catch(value);
const intField = (value: number) => z.number().int().nonnegative().catch(value);
const stringField = (value: string) => z.string().catch(value);
const toCatchRecord = (value: AppConfig): Record<string, unknown> =>
  Object.entries(value).reduce<Record<string, unknown>>((record, [key, entryValue]) => {
    record[key] = entryValue;
    return record;
  }, {});

const defaultBase46Presets: Record<
  string,
  z.output<typeof Base46ThemePresetInputSchema>
> = Object.fromEntries(
  Object.entries(DEFAULT_APP_CONFIG.themes.base46Presets).map(([presetId, preset]) => [
    presetId,
    Base46ThemePresetInputSchema.parse(preset),
  ])
);
const defaultThemeConfig = {
  base46Presets: defaultBase46Presets,
};

const GeneralSchema = z
  .object({
    language: z
      .string()
      .transform(value => normalizeAppLocale(value))
      .catch(DEFAULT_APP_CONFIG.general.language),
    theme: z.enum(['light', 'dark', 'system']).catch(DEFAULT_APP_CONFIG.general.theme),
    themePresetId: stringField(DEFAULT_APP_CONFIG.general.themePresetId),
    autoUpdate: booleanField(DEFAULT_APP_CONFIG.general.autoUpdate),
    minimizeToTray: booleanField(DEFAULT_APP_CONFIG.general.minimizeToTray),
    closeToTray: booleanField(DEFAULT_APP_CONFIG.general.closeToTray),
    startMinimized: booleanField(DEFAULT_APP_CONFIG.general.startMinimized),
    quickChatHideOnBlur: booleanField(DEFAULT_APP_CONFIG.general.quickChatHideOnBlur),
    autoApproveToolRequests: booleanField(DEFAULT_APP_CONFIG.general.autoApproveToolRequests),
  })
  .catch(DEFAULT_APP_CONFIG.general);

const UiSchema = z
  .object({
    fontSize: numberField(DEFAULT_APP_CONFIG.ui.fontSize),
    density: z.enum(['compact', 'comfortable', 'spacious']).catch(DEFAULT_APP_CONFIG.ui.density),
    chatContentPadding: numberField(DEFAULT_APP_CONFIG.ui.chatContentPadding),
    composerPadding: numberField(DEFAULT_APP_CONFIG.ui.composerPadding),
    messageBubblePaddingX: numberField(DEFAULT_APP_CONFIG.ui.messageBubblePaddingX),
    messageBubblePaddingY: numberField(DEFAULT_APP_CONFIG.ui.messageBubblePaddingY),
    messageGap: numberField(DEFAULT_APP_CONFIG.ui.messageGap),
    companion: z
      .object({
        enabled: booleanField(DEFAULT_APP_CONFIG.ui.companion.enabled),
        alwaysOnTop: booleanField(DEFAULT_APP_CONFIG.ui.companion.alwaysOnTop),
        rememberPosition: booleanField(DEFAULT_APP_CONFIG.ui.companion.rememberPosition),
        reduceMotion: booleanField(DEFAULT_APP_CONFIG.ui.companion.reduceMotion),
        openMainWindowOnClick: booleanField(DEFAULT_APP_CONFIG.ui.companion.openMainWindowOnClick),
        position: z
          .object({
            x: z.number().finite().nullable().catch(DEFAULT_APP_CONFIG.ui.companion.position.x),
            y: z.number().finite().nullable().catch(DEFAULT_APP_CONFIG.ui.companion.position.y),
          })
          .catch(DEFAULT_APP_CONFIG.ui.companion.position),
      })
      .catch(DEFAULT_APP_CONFIG.ui.companion),
  })
  .catch(DEFAULT_APP_CONFIG.ui);

const ThemesSchema = z
  .object({
    base46Presets: z.record(z.string(), Base46ThemePresetInputSchema).catch(defaultBase46Presets),
  })
  .catch(defaultThemeConfig);

const NetworkSchema = z
  .object({
    proxy: z
      .object({
        enable: booleanField(DEFAULT_APP_CONFIG.network.proxy.enable),
        type: z.enum(['http', 'https', 'socks5']).catch(DEFAULT_APP_CONFIG.network.proxy.type),
        host: stringField(DEFAULT_APP_CONFIG.network.proxy.host),
        port: z.number().finite().nullable().catch(DEFAULT_APP_CONFIG.network.proxy.port),
        username: z.string().optional(),
        password: z.string().optional(),
      })
      .catch(DEFAULT_APP_CONFIG.network.proxy),
    webSearch: z
      .object({
        preferredEngine: z
          .enum(['google', 'duckduckgo', 'bing'])
          .catch(DEFAULT_APP_CONFIG.network.webSearch.preferredEngine),
      })
      .catch(DEFAULT_APP_CONFIG.network.webSearch),
    timeout: numberField(DEFAULT_APP_CONFIG.network.timeout),
    retryAttempts: numberField(DEFAULT_APP_CONFIG.network.retryAttempts),
  })
  .catch(DEFAULT_APP_CONFIG.network);

const SecuritySchema = z
  .object({
    encryptApikeys: booleanField(DEFAULT_APP_CONFIG.security.encryptApikeys),
    requirePassword: booleanField(DEFAULT_APP_CONFIG.security.requirePassword),
    sessionTimeout: numberField(DEFAULT_APP_CONFIG.security.sessionTimeout),
    enableLogging: booleanField(DEFAULT_APP_CONFIG.security.enableLogging),
    logLevel: z
      .enum(['debug', 'info', 'warn', 'error'])
      .catch(DEFAULT_APP_CONFIG.security.logLevel),
  })
  .catch(DEFAULT_APP_CONFIG.security);

const KeybindingsSchema = z
  .object({
    sendMessage: stringField(DEFAULT_APP_CONFIG.keybindings.sendMessage),
    openSettings: stringField(DEFAULT_APP_CONFIG.keybindings.openSettings),
  })
  .catch(DEFAULT_APP_CONFIG.keybindings);

const ChatSchema = z
  .object({
    composer: z
      .object({
        preferredProviderId: stringField(DEFAULT_APP_CONFIG.chat.composer.preferredProviderId),
        preferredModel: stringField(DEFAULT_APP_CONFIG.chat.composer.preferredModel),
      })
      .catch(DEFAULT_APP_CONFIG.chat.composer),
  })
  .catch(DEFAULT_APP_CONFIG.chat);

const ContextSchema = z
  .object({
    enabled: booleanField(DEFAULT_APP_CONFIG.context.enabled),
    maxIdentityTokens: intField(DEFAULT_APP_CONFIG.context.maxIdentityTokens),
    maxSkillTokens: intField(DEFAULT_APP_CONFIG.context.maxSkillTokens),
  })
  .catch(DEFAULT_APP_CONFIG.context);

const SpeechSchema = z
  .object({
    enabled: booleanField(DEFAULT_APP_CONFIG.speech.enabled),
    providerType: z
      .enum(['openai', 'whisper-node', ''])
      .catch(DEFAULT_APP_CONFIG.speech.providerType),
    apiKey: stringField(DEFAULT_APP_CONFIG.speech.apiKey),
    baseUrl: stringField(DEFAULT_APP_CONFIG.speech.baseUrl),
    downloadBaseUrl: stringField(DEFAULT_APP_CONFIG.speech.downloadBaseUrl),
    model: stringField(DEFAULT_APP_CONFIG.speech.model),
    modelPath: stringField(DEFAULT_APP_CONFIG.speech.modelPath),
    language: stringField(DEFAULT_APP_CONFIG.speech.language),
    prompt: stringField(DEFAULT_APP_CONFIG.speech.prompt),
  })
  .catch(DEFAULT_APP_CONFIG.speech);

const ToolModelSchema = z
  .object({
    providerId: stringField(DEFAULT_APP_CONFIG.toolModel.providerId),
    model: stringField(DEFAULT_APP_CONFIG.toolModel.model),
  })
  .catch(DEFAULT_APP_CONFIG.toolModel);

const ToolExecutionSchema = z
  .object({
    shellApprovalMode: z
      .literal('always')
      .catch(DEFAULT_APP_CONFIG.toolExecution.shellApprovalMode),
  })
  .catch(DEFAULT_APP_CONFIG.toolExecution);

const McpSchema = z
  .object({
    enabled: booleanField(DEFAULT_APP_CONFIG.mcp.enabled),
    connectOnStartup: booleanField(DEFAULT_APP_CONFIG.mcp.connectOnStartup),
    allowRemoteServers: booleanField(DEFAULT_APP_CONFIG.mcp.allowRemoteServers),
    defaultApprovalMode: z
      .enum(['always', 'safe-only', 'never'])
      .catch(DEFAULT_APP_CONFIG.mcp.defaultApprovalMode),
    requestTimeoutMs: numberField(DEFAULT_APP_CONFIG.mcp.requestTimeoutMs),
    maxConcurrentRequests: intField(DEFAULT_APP_CONFIG.mcp.maxConcurrentRequests),
  })
  .catch(DEFAULT_APP_CONFIG.mcp);

const DaemonSchema = z
  .object({
    host: stringField(DEFAULT_APP_CONFIG.daemon.host),
    port: z.number().int().min(1).max(65535).catch(DEFAULT_APP_CONFIG.daemon.port),
  })
  .catch(DEFAULT_APP_CONFIG.daemon);

export const AppConfigSchema = z
  .object({
    general: GeneralSchema,
    ui: UiSchema,
    themes: ThemesSchema,
    network: NetworkSchema,
    security: SecuritySchema,
    keybindings: KeybindingsSchema,
    chat: ChatSchema,
    context: ContextSchema,
    speech: SpeechSchema,
    toolModel: ToolModelSchema,
    toolExecution: ToolExecutionSchema,
    mcp: McpSchema,
    daemon: DaemonSchema,
  })
  .passthrough()
  .catch(toCatchRecord(DEFAULT_APP_CONFIG));
