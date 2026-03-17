import path from 'path';
import fs from 'fs-extra';
import type { AppConfig } from '../shared/types/config';
import { getDisplayScale, getLocale, getTheme, getUserDataPath } from './platform';

// Pure function: detect system and generate dynamic default configuration
function getSystemConfig(): AppConfig {
  const locale = getLocale();
  const scale = getDisplayScale();

  return {
    ui: {
      // Use larger font for high-scale displays
      fontSize: scale > 1.5 ? 16 : 14,
      // Use spacious layout for high-resolution displays
      density: scale > 1.25 ? 'spacious' : scale < 1 ? 'compact' : 'comfortable',
      chatContentPadding: 24,
      composerPadding: 10,
      messageBubblePaddingX: 16,
      messageBubblePaddingY: 12,
      messageGap: 18,
    },
    general: {
      language: locale || 'en',
      theme: getTheme(),
      autoUpdate: true,
      minimizeToTray: false,
      closeToTray: false,
      startMinimized: false,
      quickChatHideOnBlur: false,
    },
    network: {
      proxy: { enable: false, type: 'http', host: '', port: null },
      timeout: 5000,
      retryAttempts: 3,
    },
    security: {
      encryptApikeys: true,
      requirePassword: false,
      sessionTimeout: 60,
      enableLogging: true,
      logLevel: 'info',
    },
    advanced: {
      enableExperimentalFeatures: false,
      debugMode: false,
      developerMode: false,
    },
    // Automatically identify OS settings for keybindings
    keybindings: {
      sendMessage: 'Enter',
      openSettings: process.platform === 'darwin' ? 'Cmd+,' : 'Ctrl+,',
    },
    memory: {
      enabled: false,
      autoSummarize: false,
      maxRetrievalCount: 5,
      similarThreshold: 0.1,
    },
    toolModel: { model: '' },
    toolExecution: {
      shellApprovalMode: 'high-risk',
      shellHighRiskPatterns: [],
    },
    agent: {
      enabled: false,
      systemPrompt: 'You are a helpful AI assistant. You are capable, autonomous, and helpful.',
      providerType: '',
      model: '',
      temperature: 0.1,
      maxTokens: 2000,
      maxIterations: 10,
      enableTools: false,
      enableMemory: false,
    },
  };
}

// Simplified configuration manager
export class ConfigManager {
  private path = path.join(getUserDataPath(), 'iki-config.json');

  async read() {
    try {
      // In src/main/services/config.ts's read() method
      console.log('📂 Checking config file at:', this.path);
      console.log('📂 File exists?', fs.existsSync(this.path)); // Critical log
      return await fs.readJson(this.path); // Use existing config
    } catch {
      return getSystemConfig(); // Use dynamic config for initial startup
    }
  }

  async write(config: AppConfig) {
    await fs.writeJson(this.path, config, { spaces: 2 });
  }
}
