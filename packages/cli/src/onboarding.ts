import readline from 'node:readline/promises';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';
import { addProvider, getProviders, type ProviderDeclaration } from '@iki/store/providers';
import type { Provider } from '@iki/core/types/provider';

type EnvProviderPreset = {
  id: string;
  name: string;
  type: string;
  apiKeyEnv: string[];
  baseUrlEnv?: string;
  modelEnv?: string;
  defaultBaseUrl: string;
  defaultModel: string;
  requiresApiKey: boolean;
};

const CLI_PROVIDER_PRESETS: readonly EnvProviderPreset[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    apiKeyEnv: ['ANTHROPIC_API_KEY'],
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
    modelEnv: 'ANTHROPIC_MODEL',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    requiresApiKey: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    apiKeyEnv: ['OPENAI_API_KEY'],
    baseUrlEnv: 'OPENAI_BASE_URL',
    modelEnv: 'OPENAI_MODEL',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1',
    requiresApiKey: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'deepseek',
    apiKeyEnv: ['DEEPSEEK_API_KEY'],
    baseUrlEnv: 'DEEPSEEK_BASE_URL',
    modelEnv: 'DEEPSEEK_MODEL',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    requiresApiKey: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai-compatible',
    apiKeyEnv: ['OPENROUTER_API_KEY'],
    baseUrlEnv: 'OPENROUTER_BASE_URL',
    modelEnv: 'OPENROUTER_MODEL',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4',
    requiresApiKey: true,
  },
  {
    id: 'kimi',
    name: 'Moonshot (Kimi)',
    type: 'openai-compatible',
    apiKeyEnv: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    baseUrlEnv: 'MOONSHOT_BASE_URL',
    modelEnv: 'KIMI_MODEL',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2-0711-preview',
    requiresApiKey: true,
  },
  {
    id: 'gemini',
    name: 'Google Gemini (OpenAI-compat)',
    type: 'openai-compatible',
    apiKeyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    baseUrlEnv: 'GEMINI_BASE_URL',
    modelEnv: 'GEMINI_MODEL',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    requiresApiKey: true,
  },
];

type DetectedEnvProvider = {
  declaration: ProviderDeclaration;
  sourceEnv: string;
};

const readFirstEnv = (
  env: Readonly<Record<string, string | undefined>>,
  keys: readonly string[]
): { key: string; value: string } | null => {
  for (const key of keys) {
    const val = env[key]?.trim();
    if (val) return { key, value: val };
  }
  return null;
};

/**
 * Inspects standard provider environment variables and returns ready-to-save provider declarations.
 */
const detectEnvProviderSpecs = (
  env: Readonly<Record<string, string | undefined>> = process.env
): DetectedEnvProvider[] => {
  const detected: DetectedEnvProvider[] = [];

  const customBaseUrl = env.IKI_BASE_URL?.trim();
  const customApiKey = env.IKI_API_KEY?.trim();
  const customModel = env.IKI_MODEL?.trim();
  if (customBaseUrl) {
    detected.push({
      sourceEnv: customApiKey ? 'IKI_BASE_URL + IKI_API_KEY' : 'IKI_BASE_URL',
      declaration: {
        id: 'custom',
        name: 'Custom Gateway',
        type: 'openai-compatible',
        apiKey: customApiKey || 'not-required',
        baseUrl: customBaseUrl,
        enabled: true,
        models: customModel ? [customModel] : [],
      },
    });
  }

  for (const preset of CLI_PROVIDER_PRESETS) {
    const hit = readFirstEnv(env, preset.apiKeyEnv);
    if (!hit) continue;
    const baseUrl = (preset.baseUrlEnv ? env[preset.baseUrlEnv]?.trim() : '') || preset.defaultBaseUrl;
    const model = (preset.modelEnv ? env[preset.modelEnv]?.trim() : '') || preset.defaultModel;
    detected.push({
      sourceEnv: hit.key,
      declaration: {
        id: preset.id,
        name: preset.name,
        type: preset.type,
        apiKey: hit.value,
        baseUrl,
        enabled: true,
        models: [model],
      },
    });
  }

  return detected;
};

/**
 * Persists detected environment providers into `models.toml` without overwriting user-configured ids.
 * Returns the newly added providers.
 */
export const bootstrapProvidersFromEnv = (
  env: Readonly<Record<string, string | undefined>> = process.env
): Array<{ provider: Provider; sourceEnv: string }> => {
  const existingIds = new Set(getProviders().map(p => p.id));
  const candidates = detectEnvProviderSpecs(env);
  const created: Array<{ provider: Provider; sourceEnv: string }> = [];

  for (const item of candidates) {
    if (existingIds.has(item.declaration.id)) continue;
    const saved = addProvider(item.declaration);
    existingIds.add(saved.id);
    created.push({ provider: saved, sourceEnv: item.sourceEnv });
  }
  return created;
};

export const formatMissingProviderGuide = (dataDir: string): string =>
  [
    'No enabled LLM provider found.',
    '',
    'Fastest ways to get started:',
    '  1. Export an API key and re-run (auto-detected on startup):',
    '       export DEEPSEEK_API_KEY="sk-..."   # or ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY',
    '       iki',
    '  2. Run the interactive setup wizard:',
    '       iki setup',
    `  3. Or edit ${dataDir}/models.toml directly.`,
  ].join('\n');

const WIZARD_CHOICES: ReadonlyArray<{
  label: string;
  id: string;
  name: string;
  type: string;
  defaultBaseUrl: string;
  defaultModel: string;
  requiresApiKey: boolean;
}> = [
  ...CLI_PROVIDER_PRESETS.map(p => ({
    label: `${p.name} (${p.defaultBaseUrl})`,
    id: p.id,
    name: p.name,
    type: p.type,
    defaultBaseUrl: p.defaultBaseUrl,
    defaultModel: p.defaultModel,
    requiresApiKey: p.requiresApiKey,
  })),
  {
    label: 'Custom OpenAI-compatible / Local Gateway',
    id: 'custom_gateway',
    name: 'Custom Gateway',
    type: 'openai-compatible',
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    defaultModel: '',
    requiresApiKey: false,
  },
  {
    label: 'Ollama (local, no API key)',
    id: 'ollama',
    name: 'Ollama',
    type: 'openai-compatible',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5-coder:7b',
    requiresApiKey: false,
  },
];

/**
 * Interactive terminal wizard that writes a ready-to-use provider entry into `models.toml`.
 */
export const runCliOnboardingWizard = async (options: {
  dataDir: string;
  discoverModels?: (params: {
    providerType: string;
    baseUrl: string;
    apiKey?: string;
  }) => Promise<string[]>;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}): Promise<Provider | null> => {
  const input = options.input ?? defaultInput;
  const output = options.output ?? defaultOutput;
  const rl = readline.createInterface({ input, output });
  const lineIter = rl[Symbol.asyncIterator]();

  const writeLine = (line = '') => {
    output.write(`${line}\n`);
  };
  const ask = async (prompt: string): Promise<string | null> => {
    output.write(prompt);
    const next = await lineIter.next();
    return next.done ? null : String(next.value);
  };

  try {
    writeLine('');
    writeLine('Welcome to iKi — Quick Provider Setup');
    writeLine(`Config file: ${options.dataDir}/models.toml`);
    writeLine('');
    WIZARD_CHOICES.forEach((choice, idx) => {
      writeLine(`  ${idx + 1}. ${choice.label}`);
    });
    writeLine('');

    const rawIdxInput = await ask(`Select provider [1-${WIZARD_CHOICES.length}] (default 1): `);
    if (rawIdxInput === null) return null;
    const rawIdx = rawIdxInput.trim();
    const parsedIdx = rawIdx ? Number.parseInt(rawIdx, 10) : 1;
    const choice =
      Number.isFinite(parsedIdx) && parsedIdx >= 1 && parsedIdx <= WIZARD_CHOICES.length
        ? WIZARD_CHOICES[parsedIdx - 1]!
        : WIZARD_CHOICES[0]!;

    const rawBaseUrlInput = await ask(`Base URL (default ${choice.defaultBaseUrl}): `);
    if (rawBaseUrlInput === null) return null;
    const baseUrl = rawBaseUrlInput.trim() || choice.defaultBaseUrl;

    const apiKeyPrompt = choice.requiresApiKey
      ? 'API Key: '
      : 'API Key (optional, press Enter to skip): ';
    const rawApiKeyInput = await ask(apiKeyPrompt);
    if (rawApiKeyInput === null) return null;
    const rawApiKey = rawApiKeyInput.trim();
    if (choice.requiresApiKey && !rawApiKey) {
      writeLine('Aborted: API key is required for this provider.');
      return null;
    }

    let suggestedModel = choice.defaultModel;
    if (!suggestedModel && options.discoverModels) {
      writeLine('Discovering available models from endpoint...');
      try {
        const live = await options.discoverModels({
          providerType: choice.type,
          baseUrl,
          ...(rawApiKey ? { apiKey: rawApiKey } : {}),
        });
        if (live.length > 0) {
          suggestedModel = live[0]!;
          writeLine(`Found ${live.length} model(s): ${live.slice(0, 5).join(', ')}${live.length > 5 ? ', ...' : ''}`);
        }
      } catch {
        /* ignore discovery failure in wizard */
      }
    }

    const modelPrompt = suggestedModel
      ? `Default model (default ${suggestedModel}): `
      : 'Default model ID: ';
    const rawModelInput = await ask(modelPrompt);
    if (rawModelInput === null) return null;
    const model = rawModelInput.trim() || suggestedModel;
    if (!model) {
      writeLine('Aborted: a model ID is required.');
      return null;
    }

    const existing = getProviders();
    let providerId = choice.id;
    let ordinal = 1;
    while (existing.some(p => p.id === providerId && p.baseUrl !== baseUrl)) {
      ordinal += 1;
      providerId = `${choice.id}_${ordinal}`;
    }

    const saved = addProvider({
      id: providerId,
      name: choice.name,
      type: choice.type,
      apiKey: rawApiKey || 'ollama',
      baseUrl,
      enabled: true,
      models: [model],
    });

    writeLine('');
    writeLine(`Saved provider "${saved.id}" (${saved.type}, model: ${model}) to ${options.dataDir}/models.toml`);
    writeLine('');
    return saved;
  } finally {
    rl.close();
  }
};
