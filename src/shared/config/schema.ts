import { z } from 'zod';
import type { AppConfig } from '../types/config';
import { DEFAULT_APP_CONFIG } from './defaults';
import { Base46ThemePresetInputSchema } from '../theme/base46_schema';
import { normalizeAppLocale } from '../i18n/locale';

const booleanField = (value: boolean) => z.boolean().catch(value);
const numberField = (value: number) => z.number().finite().catch(value);
const intField = (value: number) => z.number().int().nonnegative().catch(value);
const ratioField = (value: number) => z.number().min(0).max(1).catch(value);
const stringField = (value: string) => z.string().catch(value);
const stringArrayField = (value: string[]) => z.array(z.string()).catch(value);
const toCatchRecord = (value: AppConfig): Record<string, unknown> =>
  Object.entries(value).reduce<Record<string, unknown>>((record, [key, entryValue]) => {
    record[key] = entryValue;
    return record;
  }, {});

const defaultBase46Presets: Record<string, z.output<typeof Base46ThemePresetInputSchema>> =
  Object.fromEntries(
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
  })
  .catch(DEFAULT_APP_CONFIG.ui);

const ThemesSchema = z
  .object({
    base46Presets: z
      .record(z.string(), Base46ThemePresetInputSchema)
      .catch(defaultBase46Presets),
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

const AdvancedSchema = z
  .object({
    enableExperimentalFeatures: booleanField(
      DEFAULT_APP_CONFIG.advanced.enableExperimentalFeatures
    ),
    debugMode: booleanField(DEFAULT_APP_CONFIG.advanced.debugMode),
    developerMode: booleanField(DEFAULT_APP_CONFIG.advanced.developerMode),
  })
  .catch(DEFAULT_APP_CONFIG.advanced);

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

const MemorySchema = z
  .object({
    enabled: booleanField(DEFAULT_APP_CONFIG.memory.enabled),
    autoSummarize: booleanField(DEFAULT_APP_CONFIG.memory.autoSummarize),
    maxRetrievalCount: numberField(DEFAULT_APP_CONFIG.memory.maxRetrievalCount),
    similarThreshold: numberField(DEFAULT_APP_CONFIG.memory.similarThreshold),
    embeddingModel: z
      .object({
        providerId: stringField(DEFAULT_APP_CONFIG.memory.embeddingModel.providerId),
        providerType: stringField(DEFAULT_APP_CONFIG.memory.embeddingModel.providerType),
        model: stringField(DEFAULT_APP_CONFIG.memory.embeddingModel.model),
      })
      .catch(DEFAULT_APP_CONFIG.memory.embeddingModel),
    context: z
      .object({
        enabled: booleanField(DEFAULT_APP_CONFIG.memory.context.enabled),
        recentMessageCount: intField(DEFAULT_APP_CONFIG.memory.context.recentMessageCount),
        maxRecentTokens: intField(DEFAULT_APP_CONFIG.memory.context.maxRecentTokens),
        maxMessageTokens: intField(DEFAULT_APP_CONFIG.memory.context.maxMessageTokens),
        maxIdentityTokens: intField(DEFAULT_APP_CONFIG.memory.context.maxIdentityTokens),
        maxPresenceStateTokens: intField(
          DEFAULT_APP_CONFIG.memory.context.maxPresenceStateTokens
        ),
        maxRuntimeReflectionTokens: intField(
          DEFAULT_APP_CONFIG.memory.context.maxRuntimeReflectionTokens
        ),
        summaryTriggerMessages: intField(DEFAULT_APP_CONFIG.memory.context.summaryTriggerMessages),
        summaryRecentMessages: intField(DEFAULT_APP_CONFIG.memory.context.summaryRecentMessages),
        maxSummaryTokens: intField(DEFAULT_APP_CONFIG.memory.context.maxSummaryTokens),
        maxMemoryTokens: intField(DEFAULT_APP_CONFIG.memory.context.maxMemoryTokens),
        maxSkillTokens: intField(DEFAULT_APP_CONFIG.memory.context.maxSkillTokens),
      })
      .catch(DEFAULT_APP_CONFIG.memory.context),
    emotion: z
      .object({
        enabled: booleanField(DEFAULT_APP_CONFIG.memory.emotion.enabled),
        injectToSystemPrompt: booleanField(DEFAULT_APP_CONFIG.memory.emotion.injectToSystemPrompt),
        realtimeAnalysis: booleanField(DEFAULT_APP_CONFIG.memory.emotion.realtimeAnalysis),
        minConfidence: numberField(DEFAULT_APP_CONFIG.memory.emotion.minConfidence),
        minSampleCount: numberField(DEFAULT_APP_CONFIG.memory.emotion.minSampleCount),
        windowSize: numberField(DEFAULT_APP_CONFIG.memory.emotion.windowSize),
        halfLifeMinutes: numberField(DEFAULT_APP_CONFIG.memory.emotion.halfLifeMinutes),
        maxAgeMinutes: numberField(DEFAULT_APP_CONFIG.memory.emotion.maxAgeMinutes),
        includeNeutral: booleanField(DEFAULT_APP_CONFIG.memory.emotion.includeNeutral),
        toolGuard: z
          .object({
            enabled: booleanField(DEFAULT_APP_CONFIG.memory.emotion.toolGuard.enabled),
            minConfidence: numberField(DEFAULT_APP_CONFIG.memory.emotion.toolGuard.minConfidence),
            minArousal: numberField(DEFAULT_APP_CONFIG.memory.emotion.toolGuard.minArousal),
            maxValence: numberField(DEFAULT_APP_CONFIG.memory.emotion.toolGuard.maxValence),
            requireApproval: booleanField(
              DEFAULT_APP_CONFIG.memory.emotion.toolGuard.requireApproval
            ),
            disableAutoTools: booleanField(
              DEFAULT_APP_CONFIG.memory.emotion.toolGuard.disableAutoTools
            ),
          })
          .catch(DEFAULT_APP_CONFIG.memory.emotion.toolGuard),
      })
      .catch(DEFAULT_APP_CONFIG.memory.emotion),
  })
  .catch(DEFAULT_APP_CONFIG.memory);

const ContinuitySchema = z
  .object({
    enabled: booleanField(DEFAULT_APP_CONFIG.continuity.enabled),
    autoCaptureExplicitFacts: booleanField(
      DEFAULT_APP_CONFIG.continuity.autoCaptureExplicitFacts
    ),
    injectToSystemPrompt: booleanField(DEFAULT_APP_CONFIG.continuity.injectToSystemPrompt),
    useLegacyContextBlocks: booleanField(DEFAULT_APP_CONFIG.continuity.useLegacyContextBlocks),
    maxRetrievedItems: intField(DEFAULT_APP_CONFIG.continuity.maxRetrievedItems),
  })
  .catch(DEFAULT_APP_CONFIG.continuity);

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
    providerType: stringField(DEFAULT_APP_CONFIG.toolModel.providerType),
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

const BridgesSchema = z
  .object({
    napcat: z
      .object({
        enabled: booleanField(DEFAULT_APP_CONFIG.bridges.napcat.enabled),
        accessToken: stringField(DEFAULT_APP_CONFIG.bridges.napcat.accessToken),
        providerType: stringField(DEFAULT_APP_CONFIG.bridges.napcat.providerType),
        model: stringField(DEFAULT_APP_CONFIG.bridges.napcat.model),
        tools: stringArrayField(DEFAULT_APP_CONFIG.bridges.napcat.tools),
        requireMention: booleanField(DEFAULT_APP_CONFIG.bridges.napcat.requireMention),
      })
      .catch(DEFAULT_APP_CONFIG.bridges.napcat),
  })
  .catch(DEFAULT_APP_CONFIG.bridges);

const WorkflowOptimizationSchema = z
  .object({
    enabled: booleanField(DEFAULT_APP_CONFIG.workflowOptimization.enabled),
    autoPinSkills: booleanField(DEFAULT_APP_CONFIG.workflowOptimization.autoPinSkills),
    minAutoSkillRuns: intField(DEFAULT_APP_CONFIG.workflowOptimization.minAutoSkillRuns),
    minSkillSelections: intField(DEFAULT_APP_CONFIG.workflowOptimization.minSkillSelections),
    pinConfidence: ratioField(DEFAULT_APP_CONFIG.workflowOptimization.pinConfidence),
    unpinConfidence: ratioField(DEFAULT_APP_CONFIG.workflowOptimization.unpinConfidence),
    maxPinnedSkills: intField(DEFAULT_APP_CONFIG.workflowOptimization.maxPinnedSkills),
  })
  .catch(DEFAULT_APP_CONFIG.workflowOptimization);

const AgentSchema = z
  .object({
    enabled: booleanField(DEFAULT_APP_CONFIG.agent.enabled),
    systemPrompt: stringField(DEFAULT_APP_CONFIG.agent.systemPrompt),
    providerType: stringField(DEFAULT_APP_CONFIG.agent.providerType),
    model: stringField(DEFAULT_APP_CONFIG.agent.model),
    temperature: numberField(DEFAULT_APP_CONFIG.agent.temperature),
    maxTokens: numberField(DEFAULT_APP_CONFIG.agent.maxTokens),
    maxIterations: numberField(DEFAULT_APP_CONFIG.agent.maxIterations),
    enableTools: booleanField(DEFAULT_APP_CONFIG.agent.enableTools),
    enableMemory: booleanField(DEFAULT_APP_CONFIG.agent.enableMemory),
  })
  .catch(DEFAULT_APP_CONFIG.agent);

export const AppConfigSchema = z
  .object({
    general: GeneralSchema,
    ui: UiSchema,
    themes: ThemesSchema,
    network: NetworkSchema,
    security: SecuritySchema,
    advanced: AdvancedSchema,
    keybindings: KeybindingsSchema,
    chat: ChatSchema,
    memory: MemorySchema,
    continuity: ContinuitySchema,
    speech: SpeechSchema,
    toolModel: ToolModelSchema,
    toolExecution: ToolExecutionSchema,
    mcp: McpSchema,
    daemon: DaemonSchema,
    bridges: BridgesSchema,
    workflowOptimization: WorkflowOptimizationSchema,
    agent: AgentSchema,
  })
  .passthrough()
  .catch(toCatchRecord(DEFAULT_APP_CONFIG));

export type AppConfigSchemaType = AppConfig;
