export type SupportedLocale = 'en' | 'zh-CN';

export type AppConfigLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppConfig {
  security: {
    encryptApikeys: boolean;
    requirePassword: boolean;
    sessionTimeout: number;
    enableLogging: boolean;
    logLevel: AppConfigLogLevel;
  };
  agent: {
    enabled: boolean;
    systemPrompt: string;
    providerType: string;
    model: string;
    temperature: number;
    maxTokens: number;
    maxIterations: number;
    enableTools: boolean;
    enableMemory: boolean;
  };
}
