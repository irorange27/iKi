import { z } from 'zod';
import { DEFAULT_APP_CONFIG } from './defaults';

const booleanField = (value: boolean) => z.boolean().catch(value);
const numberField = (value: number) => z.number().finite().catch(value);
const intField = (value: number) => z.number().int().nonnegative().catch(value);
const ratioField = (value: number) => z.number().min(0).max(1).catch(value);
const stringField = (value: string) => z.string().catch(value);
const stringArrayField = (value: string[]) => z.array(z.string()).catch(value);

const GeneralSchema = z
  .object({
    language: stringField(DEFAULT_APP_CONFIG.general.language),
    theme: z
      .enum(['light', 'dark', 'system'])
      .catch(DEFAULT_APP_CONFIG.general.theme),
    autoUpdate: booleanField(DEFAULT_APP_CONFIG.general.autoUpdate),
    minimizeToTray: booleanField(DEFAULT_APP_CONFIG.general.minimizeToTray),
    closeToTray: booleanField(DEFAULT_APP_CONFIG.general.closeToTray),
    startMinimized: booleanField(DEFAULT_APP_CONFIG.general.startMinimized),
    quickChatHideOnBlur: booleanField(DEFAULT_APP_CONFIG.general.quickChatHideOnBlur),
  })
  .catch(DEFAULT_APP_CONFIG.general);

const UiSchema = z
  .object({
    fontSize: numberField(DEFAULT_APP_CONFIG.ui.fontSize),
    density: z
      .enum(['compact', 'comfortable', 'spacious'])
      .catch(DEFAULT_APP_CONFIG.ui.density),
    chatContentPadding: numberField(DEFAULT_APP_CONFIG.ui.chatContentPadding),
    composerPadding: numberField(DEFAULT_APP_CONFIG.ui.composerPadding),
    messageBubblePaddingX: numberField(DEFAULT_APP_CONFIG.ui.messageBubblePaddingX),
    messageBubblePaddingY: numberField(DEFAULT_APP_CONFIG.ui.messageBubblePaddingY),
    messageGap: numberField(DEFAULT_APP_CONFIG.ui.messageGap),
  })
  .catch(DEFAULT_APP_CONFIG.ui);

const NetworkSchema = z
  .object({
    proxy: z
      .object({
        enable: booleanField(DEFAULT_APP_CONFIG.network.proxy.enable),
        type: z
          .enum(['http', 'https', 'socks5'])
          .catch(DEFAULT_APP_CONFIG.network.proxy.type),
        host: stringField(DEFAULT_APP_CONFIG.network.proxy.host),
        port: z
          .number()
          .finite()
          .nullable()
          .catch(DEFAULT_APP_CONFIG.network.proxy.port),
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

const MemorySchema = z
  .object({
    enabled: booleanField(DEFAULT_APP_CONFIG.memory.enabled),
    autoSummarize: booleanField(DEFAULT_APP_CONFIG.memory.autoSummarize),
    maxRetrievalCount: numberField(DEFAULT_APP_CONFIG.memory.maxRetrievalCount),
    similarThreshold: numberField(DEFAULT_APP_CONFIG.memory.similarThreshold),
    emotion: z
      .object({
        enabled: booleanField(DEFAULT_APP_CONFIG.memory.emotion.enabled),
        injectToSystemPrompt: booleanField(
          DEFAULT_APP_CONFIG.memory.emotion.injectToSystemPrompt
        ),
        minConfidence: numberField(DEFAULT_APP_CONFIG.memory.emotion.minConfidence),
        minSampleCount: numberField(DEFAULT_APP_CONFIG.memory.emotion.minSampleCount),
        windowSize: numberField(DEFAULT_APP_CONFIG.memory.emotion.windowSize),
        halfLifeMinutes: numberField(DEFAULT_APP_CONFIG.memory.emotion.halfLifeMinutes),
        maxAgeMinutes: numberField(DEFAULT_APP_CONFIG.memory.emotion.maxAgeMinutes),
        includeNeutral: booleanField(DEFAULT_APP_CONFIG.memory.emotion.includeNeutral),
      })
      .catch(DEFAULT_APP_CONFIG.memory.emotion),
  })
  .catch(DEFAULT_APP_CONFIG.memory);

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
    model: stringField(DEFAULT_APP_CONFIG.toolModel.model),
  })
  .catch(DEFAULT_APP_CONFIG.toolModel);

const ToolExecutionSchema = z
  .object({
    shellApprovalMode: z
      .enum(['high-risk', 'always', 'never'])
      .catch(DEFAULT_APP_CONFIG.toolExecution.shellApprovalMode),
    shellHighRiskPatterns: stringArrayField(
      DEFAULT_APP_CONFIG.toolExecution.shellHighRiskPatterns
    ),
  })
  .catch(DEFAULT_APP_CONFIG.toolExecution);

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
    network: NetworkSchema,
    security: SecuritySchema,
    advanced: AdvancedSchema,
    keybindings: KeybindingsSchema,
    memory: MemorySchema,
    speech: SpeechSchema,
    toolModel: ToolModelSchema,
    toolExecution: ToolExecutionSchema,
    workflowOptimization: WorkflowOptimizationSchema,
    agent: AgentSchema,
  })
  .passthrough()
  .catch(DEFAULT_APP_CONFIG);

export type AppConfigSchemaType = z.infer<typeof AppConfigSchema>;
