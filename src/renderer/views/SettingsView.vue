<template>
  <div class="settings-container">
    <div class="titlebar-drag-region"></div>
    <!-- Left Nav -->
    <aside class="settings-nav">
      <ul class="nav-menu">
        <li
          v-for="item in menuItems"
          :key="item.key"
          :class="{ active: activeSection === item.key }"
          @click="activeSection = item.key"
        >
          <span class="icon">
            <component :is="item.icon" :size="20" />
          </span>
          {{ item.label }}
        </li>
      </ul>
    </aside>

    <!-- Right Side Config Panel -->
    <main class="settings-content">
      <!-- General -->
      <section v-show="activeSection === 'general'" class="config-section">
        <div class="section-header">
          <div class="section-header-title">
            <span class="icon"><Cog :size="20" /></span><span class="title">General</span>
          </div>
        </div>

        <div class="config-group">
          <h3>Tool Model</h3>
          <p class="group-description">
            The Tool Model is a dedicated model used for background AI operations, separate from
            your main chat model. This allows you to use a fast, cost-effective model for auxiliary
            tasks while using more capable models for conversation.
          </p>
          <div class="tool-model-selector">
            <label class="input-label">
              <div class="label-header">
                <span>Select Tool Model</span>
                <button
                  v-if="selectedToolModel"
                  class="test-model-btn"
                  @click="testToolModel"
                  :disabled="isTestingModel"
                >
                  <RefreshCw :size="14" :class="{ 'animate-spin': isTestingModel }" />
                  {{ isTestingModel ? 'Testing...' : 'Test' }}
                </button>
              </div>
              <select
                :value="config.toolModel.model"
                @change="updateToolModel('model', ($event.target as HTMLSelectElement).value)"
                class="tool-model-select"
              >
                <option value="">Auto-detect (Recommended)</option>
                <optgroup
                  v-for="provider in availableProvidersWithModels"
                  :key="provider.id"
                  :label="provider.name"
                >
                  <option v-for="model in provider.models" :key="model" :value="model">
                    {{ model }}
                  </option>
                </optgroup>
              </select>
            </label>
            <div v-if="toolModelTestResult" class="test-result" :class="toolModelTestResult.status">
              <span v-if="toolModelTestResult.status === 'success'">✅</span>
              <span v-else-if="toolModelTestResult.status === 'warning'">⚠️</span>
              <span v-else>❌</span>
              {{ toolModelTestResult.message }}
            </div>
            <div class="tool-model-info">
              <p class="info-text">
                <strong>Recommended models:</strong> gpt-4o-mini, claude-3-5-haiku,
                gemini-2.0-flash, deepseek-chat
              </p>
              <p class="info-text">
                <strong>What Tool Model does:</strong> Thread title generation, tool selection,
                parameter extraction, memory operations, and background tasks.
              </p>
              <p class="info-text warning-text">
                <strong>⚠️ Avoid reasoning models:</strong> Never use o1, o3, or extended thinking
                models as they are too slow for tool operations.
              </p>
            </div>
          </div>
        </div>

        <div class="config-group">
          <h3>Shell Tool Approval</h3>
          <p class="group-description">
            Configure when shell commands require manual approval before execution.
          </p>
          <label class="input-label">
            <span>Approval Mode</span>
            <select
              :value="config.toolExecution.shellApprovalMode"
              @change="
                updateToolExecution(
                  'shellApprovalMode',
                  ($event.target as HTMLSelectElement).value as AppConfig['toolExecution']['shellApprovalMode']
                )
              "
            >
              <option value="high-risk">Only High-risk Commands (Recommended)</option>
              <option value="always">Always Require Approval</option>
              <option value="never">Never Require Approval</option>
            </select>
          </label>
          <label class="input-label">
            <span>Custom High-risk Regex (one per line)</span>
            <textarea
              rows="5"
              :value="shellHighRiskPatternText"
              placeholder="Example: \\bgit\\s+push\\s+--force\\b"
              @input="updateShellHighRiskPatterns(($event.target as HTMLTextAreaElement).value)"
            />
          </label>
          <p class="group-description">
            Patterns here are matched in high-risk mode and force approval when matched.
          </p>
        </div>

        <div class="config-group">
          <h3>Language</h3>
          <label class="input-label">
            <select
              :value="config.general.language"
              @change="updateGeneral('language', ($event.target as HTMLSelectElement).value)"
            >
              <option value="en">English</option>
              <option value="zh-CN">简体中文</option>
            </select>
          </label>
        </div>

        <div class="config-group">
          <h3>Theme</h3>
          <div class="button-group">
            <button
              v-for="theme in themeOptions"
              :key="theme"
              :class="{ active: config.general.theme === theme }"
              @click="updateGeneral('theme', theme)"
            >
              {{ theme.charAt(0).toUpperCase() + theme.slice(1) }}
            </button>
          </div>
        </div>

        <div class="config-group">
          <h3>Startup Behavior</h3>
          <label
            v-for="key in ['startMinimized', 'minimizeToTray', 'closeToTray', 'autoUpdate']"
            :key="key"
            class="checkbox-label"
          >
            <input
              type="checkbox"
              :checked="config.general[key as keyof typeof config.general] as boolean"
              @change="updateGeneral(key as any, ($event.target as HTMLInputElement).checked)"
            />
            {{ formatLabel(key) }}
          </label>
        </div>

        <button class="reset-btn" @click="resetSection('general')">Reset General</button>
      </section>

      <div v-show="activeSection === 'provider'" class="section-header">
        <div class="section-header-title">
          <span class="icon"><BotIcon :size="20" /></span><span class="title">Providers</span>
        </div>
      </div>
      <ProvidersSettings v-show="activeSection === 'provider'" />

      <!-- UI -->
      <section v-show="activeSection === 'ui'" class="config-section">
        <div class="config-group">
          <h3>
            Font Size
            <span class="value-badge">{{ config.ui.fontSize }}px</span>
          </h3>
          <input
            type="range"
            min="10"
            max="32"
            :value="config.ui.fontSize"
            @input="setFontSize(parseInt(($event.target as HTMLInputElement).value))"
          />
        </div>

        <div class="config-group">
          <h3>
            Chat Content Padding
            <span class="value-badge">{{ config.ui.chatContentPadding }}px</span>
          </h3>
          <input
            type="range"
            min="8"
            max="40"
            :value="config.ui.chatContentPadding"
            @input="
              setUiMetric('chatContentPadding', parseInt(($event.target as HTMLInputElement).value))
            "
          />
        </div>

        <div class="config-group">
          <h3>
            Composer Padding
            <span class="value-badge">{{ config.ui.composerPadding }}px</span>
          </h3>
          <input
            type="range"
            min="4"
            max="24"
            :value="config.ui.composerPadding"
            @input="setUiMetric('composerPadding', parseInt(($event.target as HTMLInputElement).value))"
          />
        </div>

        <div class="config-group">
          <h3>
            Bubble Horizontal Padding
            <span class="value-badge">{{ config.ui.messageBubblePaddingX }}px</span>
          </h3>
          <input
            type="range"
            min="8"
            max="28"
            :value="config.ui.messageBubblePaddingX"
            @input="
              setUiMetric('messageBubblePaddingX', parseInt(($event.target as HTMLInputElement).value))
            "
          />
        </div>

        <div class="config-group">
          <h3>
            Bubble Vertical Padding
            <span class="value-badge">{{ config.ui.messageBubblePaddingY }}px</span>
          </h3>
          <input
            type="range"
            min="6"
            max="20"
            :value="config.ui.messageBubblePaddingY"
            @input="
              setUiMetric('messageBubblePaddingY', parseInt(($event.target as HTMLInputElement).value))
            "
          />
        </div>

        <div class="config-group">
          <h3>
            Message Gap
            <span class="value-badge">{{ config.ui.messageGap }}px</span>
          </h3>
          <input
            type="range"
            min="8"
            max="32"
            :value="config.ui.messageGap"
            @input="setUiMetric('messageGap', parseInt(($event.target as HTMLInputElement).value))"
          />
        </div>

        <div class="config-group">
          <h3>Interface Density</h3>
          <div class="density-options">
            <div
              v-for="density in densityOptions"
              :key="density.key"
              class="density-card"
              :class="{ active: config.ui.density === density.key }"
              @click="setDensity(density.key)"
            >
              <div class="density-preview" :data-density="density.key"></div>
              <span>{{ density.label }}</span>
            </div>
          </div>
        </div>

        <button class="reset-btn" @click="resetSection('ui')">Reset UI</button>
      </section>

      <!-- Network -->
      <section v-show="activeSection === 'network'" class="config-section">
        <h2>Network Settings</h2>

        <div class="config-group">
          <h3>Proxy</h3>
          <label class="checkbox-label">
            <input
              type="checkbox"
              :checked="config.network.proxy.enable"
              @change="updateNetwork('proxy.enable', ($event.target as HTMLInputElement).checked)"
            />
            Enable Proxy
          </label>

          <template v-if="config.network.proxy.enable">
            <label class="input-label"
              >Type
              <select
                :value="config.network.proxy.type"
                @change="updateNetwork('proxy.type', ($event.target as HTMLSelectElement).value)"
              >
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="socks5">SOCKS5</option>
              </select>
            </label>

            <label class="input-label"
              >Host
              <input
                type="text"
                :value="config.network.proxy.host"
                @input="updateNetwork('proxy.host', $event.target.value)"
              />
            </label>

            <label class="input-label"
              >Port
              <input
                type="number"
                :value="config.network.proxy.port || ''"
                @input="
                  updateNetwork(
                    'proxy.port',
                    $event.target.value ? parseInt($event.target.value) : null
                  )
                "
              />
            </label>
          </template>
        </div>

        <div class="config-group">
          <h3>Timeout & Retry</h3>
          <label class="input-label"
            >Timeout (ms):
            <input
              type="number"
              :value="config.network.timeout"
              @input="updateNetwork('timeout', parseInt($event.target.value))"
            />
          </label>
          <label class="input-label"
            >Retry Attempts:
            <input
              type="number"
              :value="config.network.retryAttempts"
              @input="updateNetwork('retryAttempts', parseInt($event.target.value))"
            />
          </label>
        </div>

        <button class="reset-btn" @click="resetSection('network')">Reset Network</button>
      </section>

      <!-- Security -->
      <section v-show="activeSection === 'security'" class="config-section">
        <h2>Security Settings</h2>

        <div class="config-group">
          <h3>Data Protection</h3>
          <label
            v-for="key in ['encryptApikeys', 'requirePassword'] as const"
            :key="key"
            class="checkbox-label"
          >
            <input
              type="checkbox"
              :checked="config.security[key]"
              @change="updateSecurity(key, ($event.target as HTMLInputElement).checked)"
            />
            {{ formatLabel(key) }}
          </label>
        </div>

        <div class="config-group">
          <h3>Session Timeout</h3>
          <label class="input-label"
            >Minutes:
            <input
              type="number"
              :value="config.security.sessionTimeout"
              @input="updateSecurity('sessionTimeout', parseInt($event.target.value))"
            />
          </label>
        </div>

        <div class="config-group">
          <h3>Logging</h3>
          <label class="checkbox-label">
            <input
              type="checkbox"
              :checked="config.security.enableLogging"
              @change="updateSecurity('enableLogging', $event.target.checked)"
            />
            Enable Logging
          </label>
          <label v-if="config.security.enableLogging" class="input-label"
            >Level:
            <select
              :value="config.security.logLevel"
              @change="updateSecurity('logLevel', $event.target.value)"
            >
              <option value="error">Error</option>
              <option value="warn">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </label>
        </div>

        <button class="reset-btn" @click="resetSection('security')">Reset Security</button>
      </section>

      <!-- Advanced -->
      <section v-show="activeSection === 'advanced'" class="config-section">
        <h2>Advanced Settings</h2>

        <div class="config-group">
          <h3>Development Mode</h3>
          <label
            v-for="key in ['debugMode', 'developerMode', 'enableExperimentalFeatures'] as const"
            :key="key"
            class="checkbox-label"
          >
            <input
              type="checkbox"
              :checked="config.advanced[key]"
              @change="updateAdvanced(key, ($event.target as HTMLInputElement).checked)"
            />
            {{ formatLabel(key) }}
          </label>
        </div>

        <button class="reset-btn" @click="resetSection('advanced')">Reset Advanced</button>
      </section>

      <!-- Keybindings -->
      <section v-show="activeSection === 'keybindings'" class="config-section">
        <h2>Keyboard Shortcuts</h2>

        <div class="config-group">
          <label v-for="(value, key) in config.keybindings" :key="key" class="input-label">
            {{ formatLabel(key) }}:
            <input type="text" :value="value" @input="updateKeybinding(key, $event.target.value)" />
          </label>
        </div>

        <button class="reset-btn" @click="resetSection('keybindings')">Reset Keybindings</button>
      </section>

      <!-- Memory -->
      <section v-show="activeSection === 'memory'" class="config-section">
        <h2>Memory Settings</h2>

        <div class="config-group">
          <label class="checkbox-label">
            <input
              type="checkbox"
              :checked="config.memory.enabled"
              @change="updateMemory('enabled', $event.target.checked)"
            />
            Enable Memory
          </label>
        </div>

        <template v-if="config.memory.enabled">
          <div class="config-group">
            <h3>Auto Actions</h3>
            <label
              v-for="key in ['autoSummarize', 'autoRetrieve'] as const"
              :key="key"
              class="checkbox-label"
            >
              <input
                type="checkbox"
                :checked="config.memory[key]"
                @change="updateMemory(key, ($event.target as HTMLInputElement).checked)"
              />
              {{ formatLabel(key) }}
            </label>
          </div>

          <div class="config-group">
            <h3>Retrieval Settings</h3>
            <label class="input-label"
              >Max Count:
              <input
                type="number"
                :value="config.memory.maxRetrievalCount"
                @input="updateMemory('maxRetrievalCount', parseInt($event.target.value))"
              />
            </label>
            <label class="input-label"
              >Similarity Threshold:
              <input
                type="number"
                step="0.1"
                :value="config.memory.similarThreshold"
                @input="updateMemory('similarThreshold', parseFloat($event.target.value))"
              />
            </label>
          </div>
        </template>

        <button class="reset-btn" @click="resetSection('memory')">Reset Memory</button>
      </section>
    </main>

    <!-- Footer operabar -->
    <div class="settings-footer">
      <span v-if="saved" class="save-status">All changes saved</span>
      <div class="footer-actions">
        <button class="secondary" @click="$emit('close')">Close</button>
        <button class="primary" @click="saveAndClose">Save</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { storeToRefs } from 'pinia';
import {
  Cog,
  Palette,
  Globe,
  Lock,
  Zap,
  Keyboard,
  Brain,
  Toolbox,
  Bot,
  MessageCircleMore,
  RefreshCw,
  BotIcon,
} from 'lucide-vue-next';

import ProvidersSettings from '../components/settings/ProvidersSettings.vue';
import { useConfigStore } from '../store/config';
import type { AppConfig } from '../../shared/types/config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

const emit = defineEmits(['close']);
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const activeSection = ref('general');
const saved = ref(true);
const providers = ref<any[]>([]);
const isTestingModel = ref(false);
const toolModelTestResult = ref<{
  status: 'success' | 'warning' | 'error';
  message: string;
} | null>(null);

// Load providers
const loadProviders = async () => {
  try {
    providers.value = await window.electronAPI.providers.list();
  } catch (error) {
    console.error('Failed to load providers:', error);
  }
};

// Computed: Get available providers with their models
const availableProvidersWithModels = computed(() => {
  return providers.value
    .filter((p: any) => p.enabled)
    .map((p: any) => {
      let models: string[] = [];
      try {
        models = JSON.parse(p.models || '[]');
      } catch {
        models = [];
      }
      return {
        id: p.id,
        name: p.name,
        type: p.type,
        models: models.filter((m: string) => {
          // Filter out reasoning models
          const lowerModel = m.toLowerCase();
          return (
            !lowerModel.includes('o1') &&
            !lowerModel.includes('o3') &&
            !lowerModel.includes('thinking')
          );
        }),
      };
    })
    .filter((p: any) => p.models.length > 0);
});

// Computed: Get selected tool model
const selectedToolModel = computed(() => {
  return config.value.toolModel.model;
});

// Test tool model performance
const testToolModel = async () => {
  if (!selectedToolModel.value) return;

  isTestingModel.value = true;
  toolModelTestResult.value = null;

  try {
    const startTime = Date.now();
    // Send a simple test message
    const result = await window.electronAPI.chat.send({
      providerType: getProviderTypeForModel(selectedToolModel.value),
      model: selectedToolModel.value,
      messages: [{ role: 'user', content: 'Say "OK"' }],
    });
    const responseTime = (Date.now() - startTime) / 1000;

    if (result.success) {
      if (responseTime < 2.5) {
        toolModelTestResult.value = {
          status: 'success',
          message: `Good! Response time: ${responseTime.toFixed(2)}s - Optimal for tool operations`,
        };
      } else if (responseTime < 5) {
        toolModelTestResult.value = {
          status: 'warning',
          message: `Slow. Response time: ${responseTime.toFixed(2)}s - Usable but may feel sluggish`,
        };
      } else {
        toolModelTestResult.value = {
          status: 'error',
          message: `Unusable. Response time: ${responseTime.toFixed(2)}s - Too slow for responsive tool use`,
        };
      }
    } else {
      toolModelTestResult.value = {
        status: 'error',
        message: `Test failed: ${result.error || 'Unknown error'}`,
      };
    }
  } catch (error: any) {
    toolModelTestResult.value = {
      status: 'error',
      message: `Test failed: ${error.message || 'Unknown error'}`,
    };
  } finally {
    isTestingModel.value = false;
  }
};

// Get provider type for a model
const getProviderTypeForModel = (model: string): string => {
  for (const provider of availableProvidersWithModels.value) {
    if (provider.models.includes(model)) {
      return provider.type;
    }
  }
  return 'openai'; // Default fallback
};

const menuItems = [
  { key: 'general', label: 'General', icon: Cog },
  { key: 'ui', label: 'Appearance', icon: Palette },
  { key: 'provider', label: 'Providers', icon: Bot },
  // { key: "chat", label: "Chat", icon: MessageCircleMore },
  // { key: "network", label: "Network", icon: Globe },
  // { key: "security", label: "Security", icon: Lock },
  // { key: "advanced", label: "Advanced", icon: Zap },
  // { key: "keybindings", label: "Keybindings", icon: Keyboard },
  // { key: "memory", label: "Memory", icon: Brain },
];

const themeOptions = ['light', 'dark', 'system'] as const;
const densityOptions = [
  { key: 'compact' as const, label: 'Compact' },
  { key: 'comfortable' as const, label: 'Comfortable' },
  { key: 'spacious' as const, label: 'Spacious' },
];

// 自动保存防抖
let saveTimer: NodeJS.Timeout;
const autoSave = () => {
  saved.value = false;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await configStore.saveConfig();
    saved.value = true;
  }, 300);
};

// Action 封装
const setFontSize = (size: number) => {
  configStore.updateUi('fontSize', size);
  autoSave();
};

const setDensity = (density: AppConfig['ui']['density']) => {
  configStore.updateUi('density', density);
  autoSave();
};

const setUiMetric = (
  key:
    | 'chatContentPadding'
    | 'composerPadding'
    | 'messageBubblePaddingX'
    | 'messageBubblePaddingY'
    | 'messageGap',
  value: number
) => {
  configStore.updateUi(key, value);
  autoSave();
};

const updateGeneral = <K extends keyof AppConfig['general']>(
  key: K,
  value: AppConfig['general'][K]
) => {
  configStore.updateGeneral(key, value);
  autoSave();
};

// 处理嵌套路径的通用方法
const updateNested = (path: string, value: any) => {
  const keys = path.split('.');
  let target: any = config.value;

  for (let i = 0; i < keys.length - 1; i++) {
    target = target[keys[i]];
  }

  target[keys[keys.length - 1]] = value;
  autoSave();
};

const updateNetwork = (path: string, value: any) => updateNested(path, value);
const updateSecurity = <K extends keyof AppConfig['security']>(
  key: K,
  value: AppConfig['security'][K]
) => {
  config.value.security[key] = value;
  autoSave();
};
const updateAdvanced = <K extends keyof AppConfig['advanced']>(
  key: K,
  value: AppConfig['advanced'][K]
) => {
  config.value.advanced[key] = value;
  autoSave();
};
const updateKeybinding = <K extends keyof AppConfig['keybindings']>(key: K, value: string) => {
  config.value.keybindings[key] = value;
  autoSave();
};
const updateMemory = <K extends keyof AppConfig['memory']>(
  key: K,
  value: AppConfig['memory'][K]
) => {
  config.value.memory[key] = value;
  autoSave();
};
const updateToolModel = (key: 'model', value: string) => {
  config.value.toolModel[key] = value;
  autoSave();
};

const updateToolExecution = <K extends keyof AppConfig['toolExecution']>(
  key: K,
  value: AppConfig['toolExecution'][K]
) => {
  config.value.toolExecution[key] = value;
  autoSave();
};

const shellHighRiskPatternText = computed(() =>
  (config.value.toolExecution.shellHighRiskPatterns || []).join('\n')
);

const updateShellHighRiskPatterns = (value: string) => {
  const patterns = value
    .split(/\r?\n/)
    .map(pattern => pattern.trim())
    .filter(Boolean)
    .slice(0, 100);
  updateToolExecution('shellHighRiskPatterns', patterns);
};

const resetSection = (section: keyof AppConfig) => {
  configStore.resetSection(section);
  saved.value = true;
};

const saveAndClose = async () => {
  await configStore.saveConfig();
  saved.value = true;
  emit('close');
};

// 工具函数
const formatLabel = (key: string) => {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
};

onMounted(async () => {
  if (!configStore.initialized) {
    configStore.initialize();
  }
  await loadProviders();
});
</script>

<style scoped>
/* 新增样式 */
.config-section {
  max-width: 700px;
}

.input-label {
  display: block;
  margin-bottom: 16px;
}

.input-label input,
.input-label select,
.input-label textarea {
  width: 100%;
  padding: 8px 12px;
  margin-top: 6px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: var(--font-size);
}

.input-label textarea {
  resize: vertical;
  min-height: 96px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
}

.checkbox-label {
  display: block;
  margin-bottom: 12px;
  cursor: pointer;
}

.checkbox-label input[type='checkbox'] {
  margin-right: 8px;
  accent-color: var(--accent-color);
}

/* 密度面板样式 */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.section-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-header-title .icon {
  display: flex;
  align-items: center;
}

.section-header-title .title {
  font-size: 1.5em;
  font-weight: 600;
}

.add-btn {
  background: var(--accent-color);
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  transition: all 0.2s;
}

.add-btn:hover {
  background: var(--accent-hover);
}

.action-btn {
  padding: 10px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s;
}

.secondary-btn {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.secondary-btn:hover {
  background: var(--bg-hover);
  border-color: var(--accent-color);
}

/* Switch Style */
.switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 20px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--border-color);
  transition: 0.4s;
}

.slider::before {
  position: absolute;
  content: '';
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  transition: 0.4s;
}

input:checked + .slider {
  background-color: var(--accent-color);
}

input:checked + .slider::before {
  transform: translateX(20px);
}

.slider.round {
  border-radius: 20px;
}

.slider.round::before {
  border-radius: 50%;
}

/* 强制覆盖为暗色主题以匹配 ChatView */
.settings-container {
  display: flex;
  height: 100vh;
  font-size: var(--font-size);
  background: var(--bg-primary);
  color: var(--text-primary);
}

/* Titlebar Drag Region */
.titlebar-drag-region {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 20px;
  -webkit-app-region: drag;
  z-index: 9999;
}

/* Custom Scrollbar */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
  margin: 4px 0;
}

::-webkit-scrollbar-thumb {
  background-color: var(--border-color);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background-color: var(--text-muted);
}

/* 左侧导航 */
.settings-nav {
  width: 220px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  padding: 24px 16px;
  padding-top: 40px;
  /* Space for drag region */
}

.nav-header h1 {
  font-size: 1.5em;
  margin-bottom: 8px;
}

.providers {
  color: var(--text-secondary);
  font-size: 0.875em;
  cursor: pointer;
}

.nav-menu {
  margin-top: 32px;
  list-style: none;
  border-color: var(--border-color);
}

.nav-menu li {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
}

.nav-menu li:hover {
  background: var(--bg-hover);
}

.nav-menu li.active {
  background: var(--bg-active);
  color: var(--accent-color);
}

/* 右侧内容 */
.settings-content {
  flex: 1;
  padding: 32px;
  padding-bottom: 80px;
  /* Space for fixed footer */
  overflow-y: auto;
}

.config-section {
  max-width: 600px;
}

.config-group {
  margin-bottom: 32px;
}

.config-group h3 {
  margin-bottom: 12px;
  font-weight: 600;
}

.group-description {
  color: var(--text-secondary);
  font-size: 0.95em;
  margin-bottom: 16px;
}

/* 主题按钮组 */
.button-group {
  display: flex;
  gap: 8px;
}

.button-group button {
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.button-group button.active {
  background: var(--accent-color);
  color: white;
  border-color: var(--accent-color);
}

/* 滑动条 */
.slider-label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.value-badge {
  background: var(--bg-active);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.875em;
}

.slider-container input[type='range'] {
  width: 100%;
  margin: 12px 0;
}

.slider-marks {
  display: flex;
  justify-content: space-between;
  font-size: 0.75em;
  color: var(--text-secondary);
}

/* 密度卡片 */
.density-options {
  display: flex;
  gap: 16px;
}

.density-card {
  flex: 1;
  padding: 16px;
  border: 2px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s;
}

.density-card.active {
  border-color: var(--accent-color);
}

.density-preview {
  height: 40px;
  background: var(--bg-secondary);
  border-radius: 4px;
  margin-bottom: 8px;
  position: relative;
}

.density-preview::before,
.density-preview::after {
  content: '';
  position: absolute;
  background: var(--border-color);
  border-radius: 2px;
}

/* Compact: 小间距 */
.density-preview[data-density='compact']::before {
  top: 6px;
  left: 6px;
  right: 6px;
  height: 4px;
}

.density-preview[data-density='compact']::after {
  bottom: 6px;
  left: 6px;
  right: 6px;
  height: 4px;
}

/* Comfortable: 中等间距 */
.density-preview[data-density='comfortable']::before {
  top: 8px;
  left: 8px;
  right: 8px;
  height: 6px;
}

.density-preview[data-density='comfortable']::after {
  bottom: 8px;
  left: 8px;
  right: 8px;
  height: 6px;
}

/* Spacious: 大间距 */
.density-preview[data-density='spacious']::before {
  top: 12px;
  left: 12px;
  right: 12px;
  height: 8px;
}

.density-preview[data-density='spacious']::after {
  bottom: 12px;
  left: 12px;
  right: 12px;
  height: 8px;
}

/* 重置按钮 */
.reset-btn {
  padding: 8px 16px;
  color: var(--danger-color);
  background: transparent;
  border: 1px solid var(--danger-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.reset-btn:hover {
  background: var(--danger-color);
  color: white;
}

/* 底部操作栏 */
.settings-footer {
  position: fixed;
  bottom: 0;
  right: 0;
  left: 220px;
  padding: 16px 32px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-primary);
  display: flex;
  justify-content: flex-end;
  /* Always keep buttons on the right */
  align-items: center;
  z-index: 100;
}

.save-status {
  color: var(--success-color);
  font-size: 0.875em;
  margin-right: auto;
  /* Push buttons to the right */
  display: flex;
  align-items: center;
  gap: 4px;
}

.save-status::before {
  content: '✓';
  font-weight: bold;
}

.footer-actions {
  display: flex;
  gap: 12px;
}

.footer-actions button {
  padding: 8px 20px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  font-weight: 500;
  font-size: 0.9em;
}

.footer-actions .secondary {
  background: transparent;
  border-color: var(--border-color);
  color: var(--text-primary);
}

.footer-actions .secondary:hover {
  background: var(--bg-hover);
  border-color: var(--text-muted);
}

.footer-actions .primary {
  background: var(--accent-color);
  color: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.footer-actions .primary:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.15);
}

.footer-actions .primary:active {
  transform: translateY(0);
}

/* 响应式密度 */
.settings-container[data-density='compact'] {
  --spacing-unit: 4px;
}

.settings-container[data-density='spacious'] {
  --spacing-unit: 16px;
}

/* Tool Model Selector Styles */
.tool-model-selector {
  margin-top: 12px;
}

.tool-model-select {
  font-family: monospace;
  font-size: 13px;
}

.label-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.test-model-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.test-model-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.test-model-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.test-result {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.test-result.success {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.test-result.warning {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(251, 191, 36, 0.3);
}

.test-result.error {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.tool-model-info {
  margin-top: 16px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.info-text {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 8px 0;
}

.info-text:first-child {
  margin-top: 0;
}

.info-text:last-child {
  margin-bottom: 0;
}

.warning-text {
  color: #fbbf24;
  font-size: 12px;
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
