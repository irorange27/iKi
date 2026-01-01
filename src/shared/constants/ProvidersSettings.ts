import type { BuiltInProvider } from '../types/settings';

export const BUILTIN_PROVIDERS: BuiltInProvider[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek AI models with advanced reasoning capabilities',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    docsUrl: 'https://platform.deepseek.com/docs',
  },
  {
    id: 'kimi',
    name: 'Moonshot AI (Kimi)',
    description: 'Moonshot AI models like Kimi with long context support',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    docsUrl: 'https://platform.moonshot.cn/docs',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Run open-source LLMs locally with Ollama',
    defaultBaseUrl: 'http://localhost:11434',
    docsUrl: 'https://ollama.com',
  },
];
