import type { BuiltInProvider } from '../types/settings';

export const BUILTIN_PROVIDERS: BuiltInProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Official OpenAI models via the AI SDK OpenAI provider',
    defaultBaseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/docs/overview',
    credentialsUrl: 'https://platform.openai.com/api-keys',
    credentialsLabel: 'OpenAI API Keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Official Claude models via the AI SDK Anthropic provider',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    docsUrl: 'https://docs.anthropic.com/en/api/overview',
    credentialsUrl: 'https://platform.claude.com/settings/keys',
    credentialsLabel: 'Anthropic Console',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek AI models with advanced reasoning capabilities',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    docsUrl: 'https://platform.deepseek.com/docs',
  },
  {
    id: 'kimi',
    name: 'Moonshot',
    description: 'Moonshot AI models like Kimi with long context support',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    docsUrl: 'https://platform.moonshot.cn/docs',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    description: 'Official MiniMax models via the AI SDK MiniMax provider',
    defaultBaseUrl: 'https://api.minimax.io/anthropic/v1',
    models: ['MiniMax-M2', 'MiniMax-M2-Stable'],
    docsUrl: 'https://platform.minimax.io',
    credentialsUrl: 'https://platform.minimax.io',
    credentialsLabel: 'MiniMax Platform',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Run open-source LLMs locally with Ollama',
    defaultBaseUrl: 'http://localhost:11434',
    docsUrl: 'https://ollama.com',
    requiresApiKey: false,
  },
];
