export const getProviderIconName = (providerId: string): string => {
  const normalizedId = providerId.trim().toLowerCase();

  const iconMap: Record<string, string> = {
    openai: 'openai',
    'openai-compatible': 'openai',
    anthropic: 'anthropic',
    claude: 'claude',
    google: 'google',
    gemini: 'gemini',
    deepseek: 'deepseek',
    kimi: 'kimi',
    ollama: 'ollama',
    openrouter: 'openrouter',
    azure: 'azure',
    qwen: 'qwen',
    mistral: 'mistral',
  };

  return iconMap[normalizedId] || normalizedId;
};
