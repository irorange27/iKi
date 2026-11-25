import readline from 'node:readline/promises';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';
import { addProvider, getProviders } from '@iki/store/providers';
import type { Provider } from '@iki/core/types/provider';
import {
  detectPiEnvProviders,
  getPiBuiltinProvider,
  listPiBuiltinProviders,
  type PiProviderSummary,
} from '@iki/harness/providers';
import { runTuiOnboardingWizard } from './setup_tui';

/**
 * Persists detected environment providers (across all 40+ pi-ai built-in providers + IKI_BASE_URL)
 * into `models.toml` without overwriting user-configured ids.
 */
export const bootstrapProvidersFromEnv = (
  env: Readonly<Record<string, string | undefined>> = process.env
): Array<{ provider: Provider; sourceEnv: string }> => {
  const existingIds = new Set(getProviders().map(p => p.id));
  const candidates = detectPiEnvProviders(env);
  const created: Array<{ provider: Provider; sourceEnv: string }> = [];

  for (const item of candidates) {
    if (existingIds.has(item.id)) continue;
    const saved = addProvider({
      id: item.id,
      name: item.name,
      type: item.type,
      apiKey: item.apiKey,
      baseUrl: item.baseUrl,
      enabled: true,
      models: item.models,
    });
    existingIds.add(saved.id);
    created.push({ provider: saved, sourceEnv: item.sourceEnv });
  }
  return created;
};

export const formatMissingProviderGuide = (dataDir: string): string => {
  const count = listPiBuiltinProviders().length;
  return [
    'No enabled LLM provider found.',
    '',
    'Fastest ways to get started:',
    `  1. Export any standard API key (${count}+ pi-ai providers auto-detected on startup):`,
    '       export ANTHROPIC_API_KEY="sk-..."   # or OPENAI_API_KEY, GEMINI_API_KEY, etc.',
    '       iki',
    '  2. Run the interactive setup wizard:',
    '       iki setup',
    `  3. Or edit ${dataDir}/models.toml directly.`,
  ].join('\n');
};

type WizardChoice = {
  id: string;
  name: string;
  type: string;
  isResponseApi?: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  requiresApiKey: boolean;
  label: string;
  suggestedModels?: string[];
};

const QUICK_PROVIDER_LIMIT = 10;

const summaryToChoice = (p: PiProviderSummary): WizardChoice => ({
  id: p.id,
  name: p.name,
  type: p.id,
  defaultBaseUrl: p.defaultBaseUrl,
  defaultModel: p.defaultModel,
  requiresApiKey: p.defaultApi !== 'bedrock-converse-stream' && p.defaultApi !== 'google-vertex',
  label: `${p.name} [${p.id}] — ${p.modelCount} models (${p.defaultApi})`,
  suggestedModels: p.models,
});

const CUSTOM_CHOICES: readonly WizardChoice[] = [
  {
    id: 'custom_openai',
    name: 'Custom (OpenAI Completions)',
    type: 'openai-compatible',
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    defaultModel: '',
    requiresApiKey: false,
    label: 'Custom — OpenAI Chat Completions (openai-completions)',
  },
  {
    id: 'custom_responses',
    name: 'Custom (OpenAI Responses)',
    type: 'openai-compatible',
    isResponseApi: true,
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    defaultModel: '',
    requiresApiKey: false,
    label: 'Custom — OpenAI Responses API (openai-responses)',
  },
  {
    id: 'custom_anthropic',
    name: 'Custom (Anthropic Messages)',
    type: 'anthropic-compatible',
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    defaultModel: '',
    requiresApiKey: false,
    label: 'Custom — Anthropic Messages API (anthropic-messages)',
  },
];

/**
 * Interactive terminal wizard backed by the full @earendil-works/pi-ai provider catalog
 * (40+ built-in providers + custom gateways + Ollama).
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
  // Use fullscreen pi-tui setup wizard in interactive TTY sessions; fall back to readline when piped/tested.
  if (!options.input && !options.output && process.stdin.isTTY && process.stdout.isTTY) {
    return await runTuiOnboardingWizard({
      dataDir: options.dataDir,
      discoverModels: options.discoverModels,
    });
  }

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
    const allPiProviders = listPiBuiltinProviders();
    const quickChoices: WizardChoice[] = [
      ...allPiProviders.slice(0, QUICK_PROVIDER_LIMIT).map(summaryToChoice),
      ...CUSTOM_CHOICES,
    ];

    writeLine('');
    writeLine(`Welcome to iKi — Quick Provider Setup (${allPiProviders.length} built-in pi-ai providers)`);
    writeLine(`Config file: ${options.dataDir}/models.toml`);
    writeLine('');
    quickChoices.forEach((choice, idx) => {
      writeLine(`  ${String(idx + 1).padStart(2)}. ${choice.label}`);
    });
    writeLine('');
    writeLine('Tip: enter a number, a pi-ai provider id (e.g. mistral), or "all" to list all.');

    let choice: WizardChoice | null = null;
    while (!choice) {
      const rawInput = await ask(`Select provider [1-${quickChoices.length}, id, or "all"] (default 1): `);
      if (rawInput === null) return null;
      const trimmed = rawInput.trim();
      if (!trimmed) {
        choice = quickChoices[0]!;
        break;
      }
      if (trimmed.toLowerCase() === 'all' || trimmed.toLowerCase() === 'list') {
        writeLine('');
        for (const p of allPiProviders) {
          writeLine(`  ${p.id.padEnd(30)} ${p.name.padEnd(24)} ${p.defaultApi} (${p.modelCount} models)`);
        }
        writeLine('');
        continue;
      }
      const parsedIdx = Number.parseInt(trimmed, 10);
      if (String(parsedIdx) === trimmed && parsedIdx >= 1 && parsedIdx <= quickChoices.length) {
        choice = quickChoices[parsedIdx - 1]!;
        break;
      }
      const byId = getPiBuiltinProvider(trimmed);
      if (byId) {
        choice = summaryToChoice(byId);
        break;
      }
      const lower = trimmed.toLowerCase();
      if (lower === 'custom' || lower === 'custom_openai' || lower === 'openai-compatible') {
        choice = CUSTOM_CHOICES[0]!;
        break;
      }
      if (lower === 'custom_responses' || lower === 'openai-responses') {
        choice = CUSTOM_CHOICES[1]!;
        break;
      }
      if (lower === 'custom_anthropic' || lower === 'anthropic-compatible') {
        choice = CUSTOM_CHOICES[2]!;
        break;
      }
      writeLine(`Unknown provider "${trimmed}". Enter 1-${quickChoices.length}, a pi-ai provider id, or "all".`);
    }

    const baseUrlPrompt = choice.defaultBaseUrl
      ? `Base URL (default ${choice.defaultBaseUrl}): `
      : 'Base URL (optional, press Enter for provider default): ';
    const rawBaseUrlInput = await ask(baseUrlPrompt);
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
    if (choice.suggestedModels && choice.suggestedModels.length > 1) {
      const sample = choice.suggestedModels.slice(0, 6).join(', ');
      const extra = choice.suggestedModels.length > 6 ? `, ... (+${choice.suggestedModels.length - 6})` : '';
      writeLine(`Catalog models: ${sample}${extra}`);
    } else if (!suggestedModel && options.discoverModels && baseUrl) {
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
      apiKey: rawApiKey || 'not-required',
      baseUrl,
      enabled: true,
      models: [model],
      ...(choice.isResponseApi ? { isResponseApi: true } : {}),
    });

    writeLine('');
    writeLine(`Saved provider "${saved.id}" (${saved.type}, model: ${model}) to ${options.dataDir}/models.toml`);
    writeLine('');
    return saved;
  } finally {
    rl.close();
  }
};
