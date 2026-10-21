
import type { JSONValue, SharedV3ProviderOptions } from './wire_types';
import type { ModelMessage } from '@iki/backend/message/model_history';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getProviders } from '../../db/providers';
import { createLogger } from '@iki/backend/logger';
import { tracePiGeneration } from '@iki/backend/observability/langfuse';
import { getPersonaPrompt } from '../../persona';
import { fetchWithTimeout } from '../../network/http';
import {
  getProviderModelOptions,
  listModelsDevProviderModels,
  lookupModelsDevModelCapability,
  mergeModelCapability,
  parseModelList,
  parseProviderModelOptionsMap,
  type ModelCapability,
  type ModelsDevCatalog,
} from '@iki/backend/utils/provider_models';
import type {
  ProviderModelOptions,
  ProviderModelOptionsMap,
} from '@iki/backend/types/provider';
import type { TokenUsageMetrics } from '@iki/backend/types/chat_usage';
import { getErrorMessage } from '@iki/backend/utils/errors';
import {
  assembleAuxRequestSystemPrompt,
  assembleRequestSystemPrompt,
} from '@iki/backend/message/system_prompt';
import {
  buildPiModel,
  callPiChat,
  projectHistoryToPiContext,
  projectUsageToIki,
} from './pi_adapter';

const factoryLogger = createLogger({ module: 'llm_factory' });
const MODELS_DEV_CACHE_TTL_MS = 3600000;
const MODELS_DEV_TIMEOUT_MS = 1200;
const MODELS_DEV_FAILURE_COOLDOWN_MS = 300000;

/**
 * Context window assumed when the catalog has no record for the model
 * (custom openai-compatible endpoints, catalog unreachable). Large enough
 * that the window itself never truncates a legit request; the token
 * budget the harnesses enforce comes from the capability resolver, not
 * from here.
 */
const PI_DEFAULT_CONTEXT_WINDOW = 128000;

/**
 * The D35 bridge: peek the CACHED catalog for this model and build the
 * capability half of a Pi model from it. Synchronous by design — a model
 * call must never block on the network for a price list. Uses the same
 * in-memory snapshot every other capability consumer reads, refreshed in
 * the background by startModelsDevCatalogRefresh; a cold cache simply
 * yields no capability and the pre-D35 defaults (text-only, zero cost)
 * apply for this call. Stored provider/model options DO override the
 * catalog, exactly as resolveModelCapability composes them.
 */
export const resolvePiModelCapability = (params: {
  providerType: string;
  modelId: string;
  providerId?: string | null;
}): {
  input?: string[];
  contextWindow?: number | null;
  maxTokens?: number | null;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
} | null => {
  const trimmedModelId = params.modelId.trim();
  if (!trimmedModelId) return null;

  try {
    const modelOptions = getStoredProviderModelOptions(
      params.providerType,
      trimmedModelId,
      params.providerId
    );
    const catalog = getModelsDevCatalogSnapshot();
    const catalogCapability = catalog
      ? lookupModelsDevModelCapability(catalog, params.providerType, trimmedModelId)
      : null;
    const capability = mergeModelCapability(
      catalogCapability,
      params.providerType,
      trimmedModelId,
      modelOptions
    );
    if (!capability) return null;

    // A stored maxInputTokens override can be TIGHTER than the catalog's
    // context window (the budget then uses the tighter one). Advertising the
    // larger number on the Pi model would let the model object claim room
    // the budget will not grant, so the Pi window is the min of the two —
    // the consumer can only be wrong in the safe direction.
    const storedInputLimit = capability.maxInputTokens;
    const catalogWindow = capability.contextWindow;

    return {
      ...(capability.modalities ? { input: capability.modalities } : {}),
      contextWindow:
        typeof storedInputLimit === 'number' && typeof catalogWindow === 'number'
          ? Math.min(storedInputLimit, catalogWindow)
          : (catalogWindow ?? storedInputLimit ?? null),
      maxTokens: capability.maxOutputTokens,
      ...(capability.costPerMillionTokens ? { cost: capability.costPerMillionTokens } : {}),
    };
  } catch {
    // A provider row that cannot be read (not configured, DB unavailable)
    // must not turn a working AI-SDK-path model into a Pi-path failure:
    // return null so buildPiModel falls back to its defaults.
    return null;
  }
};

let cachedModelsDevCatalog: ModelsDevCatalog | null = null;
let cachedModelsDevFetchedAt = 0;
let cachedModelsDevUnavailableUntil = 0;
let modelsDevRefreshInFlight: Promise<ModelsDevCatalog | null> | null = null;

export interface ProviderConfig {
  id: string;
  type: string;
  apiKey: string;
  baseURL: string;
  models: string[];
  modelOptions: ProviderModelOptionsMap;
  isResponseApi: boolean;
}

export interface ChatGenerationResult {
  text: string;
  usage: TokenUsageMetrics;
}

const readBootstrapAuthConfig = (providerType: string): ProviderConfig | null => {
  try {
    const filePath = path.join(os.homedir(), '.iki', 'agent', 'auth.json');
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const entry = raw?.[providerType];
    if (!entry || entry.type !== 'api_key' || !entry.key) return null;

    return {
      id: `_bootstrap_${providerType}`,
      type: providerType,
      apiKey: entry.key,
      baseURL: '',
      models: [],
      modelOptions: {},
      isResponseApi: false,
    };
  } catch {
    return null;
  }
};

export const getProviderConfig = (providerType: string, providerId?: string | null): ProviderConfig => {
  let providers: ReturnType<typeof getProviders> = [];
  try {
    providers = getProviders();
  } catch {
    // DB unavailable — fall through to auth.json bootstrap
  }
  const normalizedProviderId =
    typeof providerId === 'string' && providerId.trim().length > 0 ? providerId.trim() : '';
  const provider = normalizedProviderId
    ? providers.find(p => p.id === normalizedProviderId && p.enabled)
    : providers.find(p => p.type === providerType && p.enabled);

  if (!provider) {
    if (normalizedProviderId) {
      throw new Error(`Provider ${normalizedProviderId} is not configured or not enabled`);
    }
    // Fallback to auth.json bootstrap before throwing
    const bootstrap = readBootstrapAuthConfig(providerType);
    if (bootstrap) return bootstrap;
    throw new Error(`Provider ${providerType} not configured or not enabled`);
  }

  if (providerType && provider.type !== providerType) {
    throw new Error(
      `Provider ${provider.id} is type "${provider.type}", not the requested "${providerType}".`
    );
  }

  const models = parseModelList(provider.models);

  return {
    id: provider.id,
    type: provider.type,
    apiKey: provider.api_key,
    baseURL: provider.base_url || '',
    models,
    modelOptions: parseProviderModelOptionsMap(provider.model_options),
    isResponseApi: provider.is_response_api === true,
  };
};

const getStoredProviderModelOptions = (
  providerType: string,
  modelId: string,
  providerId?: string | null
) => {
  try {
    const config = getProviderConfig(providerType, providerId);
    return getProviderModelOptions(config.modelOptions, modelId);
  } catch {
    return null;
  }
};

const getStoredProviderModelContext = (
  providerType: string,
  modelId: string,
  providerId?: string | null
): { config: ProviderConfig; modelOptions: ProviderModelOptions | null } | null => {
  try {
    const config = getProviderConfig(providerType, providerId);
    return {
      config,
      modelOptions: getProviderModelOptions(config.modelOptions, modelId),
    };
  } catch {
    return null;
  }
};

const normalizeOptionalLowercaseString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
};

const shouldOmitTemperatureForModelCall = (params: {
  providerType: string;
  modelId: string;
  providerId?: string | null;
  temperature?: number;
  reasoningEffort?: string;
}): boolean => {
  if (typeof params.temperature !== 'number') return false;

  const storedContext = getStoredProviderModelContext(
    params.providerType,
    params.modelId,
    params.providerId
  );
  const usesOpenAISdkCompatibilityRules =
    params.providerType === 'openai' || storedContext?.config.isResponseApi === true;

  if (!usesOpenAISdkCompatibilityRules) {
    return false;
  }

  const providerOptions = storedContext?.modelOptions?.providerOptions;
  const reasoningEffort =
    normalizeOptionalLowercaseString(params.reasoningEffort) ??
    normalizeOptionalLowercaseString(providerOptions?.reasoningEffort);
  if (reasoningEffort === 'none') {
    return false;
  }

  return (
    providerOptions?.forceReasoning === true ||
    storedContext?.modelOptions?.supportsReasoning === true ||
    reasoningEffort !== null
  );
};

const getProviderOptionsKey = (providerType: string): string =>
  providerType === 'openai-compatible' ? 'openaiCompatible' : providerType;

const mergeReasoningEffortOverride = (
  providerType: string,
  callSettings: { providerOptions?: SharedV3ProviderOptions },
  reasoningEffort: string
): { providerOptions?: SharedV3ProviderOptions } => {
  const providerOptions = { ...(callSettings.providerOptions ?? {}) };
  const providerOptionsKey = getProviderOptionsKey(providerType);
  const perProvider = {
    ...((providerOptions[providerOptionsKey] as Record<string, JSONValue> | undefined) ?? {}),
    reasoningEffort,
  };
  return {
    providerOptions: {
      ...providerOptions,
      [providerOptionsKey]: perProvider,
    },
  };
};

export const getModelCallSettings = (
  providerType: string,
  modelId: string,
  providerId?: string | null
): { providerOptions?: SharedV3ProviderOptions } => {
  const modelOptions = getStoredProviderModelOptions(providerType, modelId, providerId);
  const providerOptions = modelOptions?.providerOptions;

  const merged: Record<string, JSONValue> = { ...(providerOptions ?? {}) };

  if (modelOptions?.supportsReasoning != null && !merged.thinking) {
    merged.thinking = { type: modelOptions.supportsReasoning ? 'enabled' : 'disabled' };
  }

  if (Object.keys(merged).length === 0) {
    return {};
  }

  return {
    providerOptions: {
      [getProviderOptionsKey(providerType)]: merged,
    },
  };
};

export const getModelGenerationSettings = (params: {
  providerType: string;
  modelId: string;
  providerId?: string | null;
  temperature?: number;
  /** Per-call reasoning effort override; wins over stored provider model options. */
  reasoningEffort?: string;
}): { providerOptions?: SharedV3ProviderOptions; temperature?: number } => {
  const storedCallSettings = getModelCallSettings(params.providerType, params.modelId, params.providerId);
  const reasoningEffort = normalizeOptionalLowercaseString(params.reasoningEffort);
  const callSettings = reasoningEffort
    ? mergeReasoningEffortOverride(params.providerType, storedCallSettings, reasoningEffort)
    : storedCallSettings;

  if (shouldOmitTemperatureForModelCall(params)) {
    return callSettings;
  }

  return typeof params.temperature === 'number'
    ? {
        ...callSettings,
        temperature: params.temperature,
      }
    : callSettings;
};

const createInstrumentedFetch = (): typeof globalThis.fetch => {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';

    if (method === 'POST' && url.includes('/chat/completions')) {
      const bodyText = init?.body as string;
      try {
        const body = JSON.parse(bodyText);
        if (!body.thinking) {
          body.thinking = { type: 'disabled' };
        }
        return globalThis.fetch(input, { ...init, body: JSON.stringify(body) });
      } catch {
        // If we can't parse the body, pass through unchanged
      }
    }
    return globalThis.fetch(input, init);
  };
};

/** The persona SECTION of a request system prompt — named for exactly what
 * it returns: identity, date/timezone, OS, cwd (text owned by src/persona.ts).
 * The provider lookup doubles as an existence check, so this throws for an
 * unconfigured provider. Placement and joining are
 * message/system_prompt.ts's contract (`assembleRequestSystemPrompt`). */
export const resolvePersonaPrompt = (providerType: string, providerId?: string | null) => {
  getProviderConfig(providerType, providerId);
  const personaPrompt = getPersonaPrompt();
  return personaPrompt;
};
/** Providers whose default openai-compatible branch the Pi supply layer
 * serves (ADR 007 first switch path). Static-factory providers (openai,
 * anthropic, anthropic-compatible, deepseek, minimax) and the Responses API
 * stay on the AI SDK until their own switch items land.
 * Wire deltas vs the AI SDK path (documented, tracked): maxTokens rides
 * max_completion_tokens for unknown baseUrls (no compat escape yet), the
 * request is streaming-shaped, and createInstrumentedFetch's unconditional
 * reasoning-disabled injection does not apply. Everything else is held equal
 * by buildPiModel's pinned protocol fields (system role, no `thinking`
 * injection, no reasoning_effort) — see the adapter for why the catalog's
 * reasoning flag must never drive the Pi model. */
/**
 * Which protocol dialect a provider's traffic speaks.
 *
 * Policy (product): prefer the Responses API wherever the provider supports it;
 * chat completions is the floor for gateways that only speak it. The table
 * below is therefore NOT "what the old AI SDK client happened to do" — it is
 * the provider's real capability, cross-checked against Pi's own catalog
 * (`@earendil-works/pi-ai/dist/providers/data/*.json`), which is the authority
 * on which api each provider serves:
 *
 *   openai-responses   → openai, cloudflare-ai-gateway, github-copilot, meta,
 *                        opencode, opencode-go, xai
 *   anthropic-messages → anthropic, minimax(-cn), openrouter, fireworks, …
 *   openai-completions → deepseek, groq, cerebras, together, baseten, …
 *
 * "Prefer responses" is applied through CAPABILITY, not by blanket default:
 * forcing responses onto a completions-only provider (DeepSeek, whose catalog
 * entry says `openai-completions`) would 404 every call. A custom/gateway row
 * is the one place the operator decides — `is_response_api` is that
 * declaration and always wins.
 *
 * This is the ONE place that answers the question, so the supply predicate and
 * every Pi model build share it. Before it existed the dialect was implied by
 * which AI SDK factory was selected — knowledge that lived nowhere and could
 * not be carried onto the Pi model.
 */
const STATIC_PROVIDER_API: Partial<Record<string, 'openai-responses' | 'anthropic-messages'>> = {
  // Responses-capable (Pi catalog: `openai-responses`).
  openai: 'openai-responses',
  // Messages-capable (Pi catalog: `anthropic-messages`). MiniMax's endpoint is
  // `/anthropic/v1`, and the compatible gateway speaks the same protocol.
  anthropic: 'anthropic-messages',
  'anthropic-compatible': 'anthropic-messages',
  minimax: 'anthropic-messages',
  // Everything else — deepseek included — speaks OpenAI chat completions, the
  // default below.
};

export const resolveProviderApi = (
  providerType: string,
  config: Pick<ProviderConfig, 'isResponseApi'>
): 'openai-completions' | 'openai-responses' | 'anthropic-messages' => {
  // An explicit flag wins over the type's default: a row can point a
  // Responses-style type at a chat-completions gateway, and a custom row can
  // declare a Responses-capable gateway the type cannot express.
  if (config.isResponseApi) return 'openai-responses';
  const declared = STATIC_PROVIDER_API[providerType];
  if (declared) return declared;
  // Chat completions is the universal floor: every OpenAI-compatible gateway
  // speaks it, so an unknown provider still works.
  return 'openai-completions';
};

const supportsPiGeneration = (_providerType: string, config: ProviderConfig): boolean =>
  // Neither a static-factory provider type nor `isResponseApi` is an exclusion
  // any more: Pi drives openai-completions, openai-responses and
  // anthropic-messages natively, so every provider iKi shipped an AI SDK client
  // for is served by the same supply. The dialect is chosen by
  // resolveProviderApi and carried onto the model.
  typeof config.baseURL === 'string' &&
  config.baseURL.trim().length > 0;

/**
 * The supply decision, with the reason it can be refused.
 *
 * A bare boolean forced every caller to invent its own story for "why not Pi",
 * and the turn silently re-routed to the AI SDK with only a log line behind it.
 * Carrying the reason lets the selector REFUSE the turn and say what part of
 * the history the Pi projection could not represent — the user sees the cause
 * instead of a different executor running their turn.
 */
export type PiTurnSupplyDecision =
  | { admitted: true; reason?: never; cause?: never }
  | { admitted: false; reason: string; cause: 'config' | 'domain' };

export const resolvePiTurnSupply = (params: {
  providerType: string;
  providerId?: string;
  modelId: string;
  history: ModelMessage[];
}): PiTurnSupplyDecision => {
  let config: ProviderConfig;
  try {
    config = getProviderConfig(params.providerType, params.providerId);
  } catch (error) {
    return {
      admitted: false,
      cause: 'config',
      reason: `provider "${params.providerType}" is not configured: ${getErrorMessage(error)}`,
    };
  }
  if (!supportsPiGeneration(params.providerType, config)) {
    return {
      admitted: false,
      cause: 'config',
      reason: `provider "${params.providerType}" has no base URL, so no model endpoint can be addressed`,
    };
  }
  try {
    projectHistoryToPiContext(params.history, params.modelId, params.providerType);
    return { admitted: true };
  } catch (error) {
    return {
      admitted: false,
      cause: 'domain',
      reason: getErrorMessage(error),
    };
  }
};

/**
 * Single-shot generation over the Pi supply layer (ADR 007, switch item 1).
 * Text-only: no tools, no inner loop. The transcript is projected by
 * projectHistoryToPiContext; usage maps onto the total-prompt convention
 * (projectUsageToIki). The model carries the catalog capability (D35:
 * modalities for image projection, cost rates so estimatedCostUsd is real).
 */
const generateViaPi = async (
  options: {
    providerType: string;
    providerId?: string;
    modelId: string;
    messages: ModelMessage[];
    extraSystemPrompt?: string;
    /**
     * The runtime-owned instruction of an AUXILIARY (single-shot) request —
     * summarizer, title, catalog selection, tool router.
     *
     * This is a SLOT declaration, not a string override: the slot owner
     * (`message/system_prompt.ts`) decides that aux content travels as
     * `extraPrompt`, and the persona-led chat assembly is skipped for aux
     * traffic instead of being silently replaced. A caller can no longer hand
     * the supply layer a pre-joined string and bypass the slot table.
     */
    auxSystemInstruction?: string;
    temperature?: number;
    maxOutputTokens?: number;
    threadId?: string;
    abortSignal?: AbortSignal;
  },
  config: ProviderConfig
): Promise<ChatGenerationResult> => {
  const capability = resolvePiModelCapability({
    providerType: options.providerType,
    ...(options.providerId ? { providerId: options.providerId } : {}),
    modelId: options.modelId,
  });
  const model = buildPiModel({
    id: options.modelId,
    providerType: config.type,
    baseUrl: config.baseURL,
    api: resolveProviderApi(options.providerType, config),
    // Single-shot generation enforces no context budget in the AI SDK path
    // either (only maxOutputTokens), so the window here is informational;
    // the catalog's own value is used when the snapshot has one.
    contextWindow: capability?.contextWindow ?? PI_DEFAULT_CONTEXT_WINDOW,
    maxTokens: options.maxOutputTokens ?? capability?.maxTokens ?? 4096,
    ...(capability?.input ? { input: capability.input } : {}),
    ...(capability?.cost ? { cost: capability.cost } : {}),
  });
  const personaPrompt = resolvePersonaPrompt(options.providerType, options.providerId);
  const { systemPrompt: transcriptSystem, messages } = projectHistoryToPiContext(
    options.messages,
    options.modelId,
    options.providerType
  );
  // Aux traffic assembles through the aux slot: a chat persona would only
  // dilute a summarizer/title/router request, and the runtime's own
  // instruction must stay attributable as `extraPrompt`.
  const systemPrompt =
    typeof options.auxSystemInstruction === 'string'
      ? assembleAuxRequestSystemPrompt({ instruction: options.auxSystemInstruction }).prompt
      : assembleRequestSystemPrompt([
          { slot: 'persona', text: personaPrompt },
          ...(typeof options.extraSystemPrompt === 'string'
            ? [{ slot: 'extraPrompt' as const, text: options.extraSystemPrompt }]
            : []),
          { slot: 'transcriptSystem', text: transcriptSystem },
        ]).prompt;

  try {
    const settle = await tracePiGeneration(
      {
        name: 'pi.chat.generate',
        model: options.modelId,
        provider: options.providerType,
        ...(options.threadId ? { sessionId: options.threadId } : {}),
        ...(typeof options.temperature === 'number'
          ? { modelParameters: { temperature: options.temperature } }
          : {}),
        input: messages.map(message => ({ role: message.role })),
      },
      onSettle =>
        (async () => {
          const eventStream = callPiChat(
            model,
            { systemPrompt, messages },
            {
              apiKey: config.apiKey,
              signal: options.abortSignal,
              ...(typeof options.maxOutputTokens === 'number'
                ? { maxTokens: options.maxOutputTokens }
                : {}),
              ...(typeof options.temperature === 'number'
                ? { temperature: options.temperature }
                : {}),
            }
          );
          const resultPromise = eventStream.result();
          for await (const _event of eventStream) {
            void _event; // drain: the final message carries text and usage
          }
          const final = await resultPromise;

          const settledText = final.content
            .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
            .map(block => block.text)
            .join('');
          // Pi resolves provider failures into a result message — the event
          // stream never rejects. The stopReason is the failure surface:
          // swallowing it would surface a dead upstream as an empty-text
          // success.
          if (final.stopReason === 'aborted' || final.stopReason === 'error') {
            const failure =
              final.stopReason === 'aborted'
                ? new DOMException(final.errorMessage || 'Generation aborted', 'AbortError')
                : new Error(final.errorMessage || 'Provider returned an error stop reason');
            onSettle({ errorMessage: getErrorMessage(failure) });
            throw failure;
          }

          const mapped = projectUsageToIki(final.usage);
          onSettle({
            output: settledText,
            usageDetails: {
              input: mapped.inputTokens,
              output: mapped.outputTokens,
              total: mapped.totalTokens,
              ...(mapped.cacheReadTokens ? { cacheRead: mapped.cacheReadTokens } : {}),
              ...(mapped.cacheWriteTokens ? { cacheWrite: mapped.cacheWriteTokens } : {}),
              ...(mapped.reasoningTokens ? { reasoning: mapped.reasoningTokens } : {}),
            },
            costUsd: final.usage.cost.total,
          });
          return { final, text: settledText, usage: mapped };
        })()
    );
    const { final, text, usage } = settle;
    if (!text) {
      factoryLogger.event({
        level: 'warn',
        event: 'llm.generate.empty',
        outcome: 'degraded',
        message: `Generation produced no text for provider "${options.providerType}" model "${options.modelId}".`,
        data: { providerType: options.providerType, modelId: options.modelId, supply: 'pi' },
      });
    }
    return {
      text,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        reasoningTokens: usage.reasoningTokens,
        // Pi computed this from the model's catalog rates (D35); 0 when the
        // model carries none.
        estimatedCostUsd: final.usage.cost.total,
      },
    };
  } catch (error) {
    factoryLogger.event({
      level: 'error',
      event: 'llm.generate.failed',
      outcome: 'failed',
      message: `Generation failed for provider "${options.providerType}" model "${options.modelId}".`,
      error,
      data: { providerType: options.providerType, modelId: options.modelId, supply: 'pi' },
    });
    throw error;
  }
};

export const generateChatWithModelMessages = async (options: {
  providerType: string;
  providerId?: string;
  modelId: string;
  messages: ModelMessage[];
  extraSystemPrompt?: string;
  /**
   * Auxiliary (single-shot) callers declare their runtime-owned instruction
   * here instead of passing a pre-joined system prompt. The slot it claims is
   * decided by `message/system_prompt.ts` (`assembleAuxRequestSystemPrompt`),
   * so aux and chat traffic stay comparable per slot. Mutually exclusive with
   * `extraSystemPrompt`: an aux request has no chat persona/turn prompt.
   */
  auxSystemInstruction?: string;
  temperature?: number;
  /** AI-SDK-path generation options (providerOptions with reasoning-effort
   * settings) — spread after getModelCallSettings so the caller wins. The Pi
   * path drops it (tracked wire delta, same family as #107's). */
  providerOptions?: SharedV3ProviderOptions;
  maxOutputTokens?: number;
  /** Optional thread id — forwarded to Langfuse as sessionId. */
  threadId?: string;
  /** Cooperative cancellation (send execution aborts on lease loss). */
  abortSignal?: AbortSignal;
}): Promise<ChatGenerationResult> => {
  const config = getProviderConfig(options.providerType, options.providerId);
  if (!supportsPiGeneration(options.providerType, config)) {
    // Pi is the only supply: a provider this layer cannot serve must fail with
    // the reason rather than quietly run the request somewhere else.
    throw new Error(
      `Provider "${options.providerType}" cannot be served: it has no base URL, so no model endpoint can be addressed.`
    );
  }
  // Per-request domain gate (ADR 007 decision 2): the projection IS the domain
  // test. A history it cannot represent is refused with the offending part
  // named — never silently re-routed to another executor.
  projectHistoryToPiContext(options.messages, options.modelId, options.providerType);
  return generateViaPi(options, config);
};

export const fetchModelsFromDev = async (providerType: string) => {
  try {
    const data = await refreshModelsDevCatalog();
    return data ? listModelsDevProviderModels(data, providerType) : [];
  } catch {
    return [];
  }
};

const hasFreshModelsDevCatalog = (now = Date.now()) =>
  Boolean(cachedModelsDevCatalog && now - cachedModelsDevFetchedAt < MODELS_DEV_CACHE_TTL_MS);

const startModelsDevCatalogRefresh = (): Promise<ModelsDevCatalog | null> => {
  const now = Date.now();
  if (hasFreshModelsDevCatalog(now)) {
    return Promise.resolve(cachedModelsDevCatalog);
  }

  if (modelsDevRefreshInFlight) {
    return modelsDevRefreshInFlight;
  }

  if (cachedModelsDevUnavailableUntil > now) {
    return Promise.resolve(cachedModelsDevCatalog);
  }

  const refreshPromise: Promise<ModelsDevCatalog | null> = (async () => {
    try {
      const response = await fetchWithTimeout(
        'https://models.dev/api.json',
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
          },
        },
        { timeoutMs: MODELS_DEV_TIMEOUT_MS, retries: 0 }
      );
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as ModelsDevCatalog;
      cachedModelsDevCatalog = data;
      cachedModelsDevFetchedAt = Date.now();
      cachedModelsDevUnavailableUntil = 0;
      return data;
    } catch (error) {
      cachedModelsDevUnavailableUntil = Date.now() + MODELS_DEV_FAILURE_COOLDOWN_MS;
      factoryLogger.warn(
        `Failed to fetch models.dev catalog; disabling remote capability lookups for ${Math.trunc(MODELS_DEV_FAILURE_COOLDOWN_MS / 1000)}s`,
        error
      );
      if (cachedModelsDevCatalog) {
        return cachedModelsDevCatalog;
      }
      return null;
    } finally {
      if (modelsDevRefreshInFlight === refreshPromise) {
        modelsDevRefreshInFlight = null;
      }
    }
  })();

  modelsDevRefreshInFlight = refreshPromise;
  return refreshPromise;
};

export const refreshModelsDevCatalog = async (): Promise<ModelsDevCatalog | null> =>
  startModelsDevCatalogRefresh();

const scheduleModelsDevCatalogRefresh = () => {
  void startModelsDevCatalogRefresh();
};

const getModelsDevCatalogSnapshot = (): ModelsDevCatalog | null => {
  if (hasFreshModelsDevCatalog()) {
    return cachedModelsDevCatalog;
  }

  scheduleModelsDevCatalogRefresh();
  return cachedModelsDevCatalog;
};

export const fetchModelCapabilityFromDev = async (
  providerType: string,
  modelId: string
): Promise<ModelCapability | null> => {
  const trimmedModelId = modelId.trim();
  if (!trimmedModelId) return null;

  const catalog = getModelsDevCatalogSnapshot();
  return catalog ? lookupModelsDevModelCapability(catalog, providerType, trimmedModelId) : null;
};

export const resolveModelCapability = async (
  providerType: string,
  modelId: string,
  providerId?: string | null
): Promise<ModelCapability | null> => {
  const trimmedModelId = modelId.trim();
  if (!trimmedModelId) return null;

  const modelOptions = getStoredProviderModelOptions(providerType, trimmedModelId, providerId);
  const baseCapability = await fetchModelCapabilityFromDev(providerType, trimmedModelId);

  return mergeModelCapability(baseCapability, providerType, trimmedModelId, modelOptions);
};

/**
 * Inject reasoning_content from reasoning content parts into each assistant
 * message's providerOptions, so that @ai-sdk/openai-compatible (and similar
 * providers) include it in the API request body. Needed for providers like MIMO
 * that require reasoning_content be passed back across all turns.
 */
export const resetModelsDevCatalogCacheForTests = () => {
  cachedModelsDevCatalog = null;
  cachedModelsDevFetchedAt = 0;
  cachedModelsDevUnavailableUntil = 0;
  modelsDevRefreshInFlight = null;
};
