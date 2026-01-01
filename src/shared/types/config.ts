export interface AppConfig {
  general: {
    language: string | 'zh' | 'en';
    theme: 'light' | 'dark' | 'system';
    autoUpdate: boolean;
    minimizeToTray: boolean;
    closeToTray: boolean;
    startMinimized: boolean;
    quickChatHideOnBlur: boolean;
  };
  ui: {
    fontSize: number; // 10-32px
    density: 'compact' | 'comfortable' | 'spacious';
  };
  network: {
    proxy: {
      enable: boolean;
      type: 'http' | 'https' | 'socks5';
      host: string;
      port: number;
      username?: string;
      password?: string;
    };
    timeout: number;
    retryAttempts: number;
  };
  security: {
    encryptApikeys: boolean;
    requirePassword: boolean;
    sessionTimeout: number;
    enableLogging: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
  advanced: {
    enableExperimentalFeatures: boolean;
    debugMode: boolean;
    developerMode: boolean;
  };
  keybindings: {
    sendMessage: string; // e.g. "Enter"
    openSettings: string; // e.g. "Cmd+," or "Ctrl+,"
  };
  memory: {
    enabled: boolean;
    autoSummarize: boolean;
    autoRetrieve: boolean;
    maxRetrievalCount: number;
    similarThreshold: number;
  };
  toolModel: {
    model: string;
  };
}
