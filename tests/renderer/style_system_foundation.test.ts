import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const GLOBALS_CSS_PATH = resolve(process.cwd(), 'src/renderer/assets/styles/globals.css');
const VARIABLES_CSS_PATH = resolve(process.cwd(), 'src/renderer/assets/styles/variables.css');
const APP_VUE_PATH = resolve(process.cwd(), 'src/renderer/App.vue');
const SETTINGS_SHARED_CSS_PATH = resolve(
  process.cwd(),
  'src/renderer/components/settings/settings_shared.css'
);
const MCP_SETTINGS_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/settings/McpSettings.vue'
);
const NAPCAT_SETTINGS_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/settings/NapCatSettings.vue'
);
const PROVIDERS_SETTINGS_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/settings/ProvidersSettings.vue'
);
const SETTINGS_LIFE_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsLifeSection.vue'
);
const SETTINGS_SELECT_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsSelect.vue'
);
const SETTINGS_USAGE_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsUsageSection.vue'
);
const SETTINGS_SPEECH_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsSpeechSection.vue'
);
const SETTINGS_TASKS_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsTasksSection.vue'
);
const SETTINGS_MEMORY_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsMemorySection.vue'
);
const SETTINGS_COLOR_SCHEME_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsColorSchemeSection.vue'
);
const THEME_EDITOR_MODAL_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/settings/ThemeEditorModal.vue'
);
const THEME_PREVIEW_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/settings/ThemePreview.vue'
);
const SETTINGS_VIEW_VUE_PATH = resolve(process.cwd(), 'src/renderer/views/SettingsView.vue');
const CHAT_INPUT_VUE_PATH = resolve(process.cwd(), 'src/renderer/components/ChatInput.vue');
const CHAT_COMPOSER_ACTIONS_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/ChatComposerActions.vue'
);
const TOOL_SELECTOR_VUE_PATH = resolve(process.cwd(), 'src/renderer/components/ToolSelector.vue');
const SKILL_SELECTOR_VUE_PATH = resolve(process.cwd(), 'src/renderer/components/SkillSelector.vue');
const WORKSPACE_SELECTOR_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/WorkspaceSelector.vue'
);
const WELCOME_SCREEN_VUE_PATH = resolve(process.cwd(), 'src/renderer/components/WelcomeScreen.vue');
const CHAT_VIEW_VUE_PATH = resolve(process.cwd(), 'src/renderer/views/ChatView.vue');
const SIDEBAR_VUE_PATH = resolve(process.cwd(), 'src/renderer/components/Sidebar.vue');

describe('renderer style system foundation', () => {
  it('loads renderer theme tokens from globals.css instead of App.vue or a second palette', () => {
    const globalsSource = readFileSync(GLOBALS_CSS_PATH, 'utf8');
    const appSource = readFileSync(APP_VUE_PATH, 'utf8');

    expect(globalsSource).toMatch(/@import '\.\/variables\.css';/);
    expect(appSource).not.toMatch(/@import '\.\/assets\/styles\/variables\.css';/);
    expect(globalsSource).not.toMatch(/:root\s*\{[\s\S]*--background:/);
    expect(globalsSource).not.toMatch(/\.dark\s*\{/);
  });

  it('defines canonical semantic and preserved visual tokens in variables.css', () => {
    const variablesSource = readFileSync(VARIABLES_CSS_PATH, 'utf8');

    expect(variablesSource).toMatch(/--theme-bg-primary:/);
    expect(variablesSource).toMatch(/--theme-surface-inset-highlight:/);
    expect(variablesSource).toMatch(/--theme-surface-shadow-md:/);
    expect(variablesSource).toMatch(/--warning-color:/);
    expect(variablesSource).toMatch(/--accent-contrast:/);
    expect(variablesSource).toMatch(/--radius-base:/);
    expect(variablesSource).toMatch(/--surface-radius:/);
    expect(variablesSource).toMatch(/--control-radius:/);
    expect(variablesSource).toMatch(/--status-success-color:/);
    expect(variablesSource).toMatch(/--status-danger-color:/);
    expect(variablesSource).toMatch(/--chat-composer-send-background:/);
    expect(variablesSource).toMatch(/--chat-composer-stop-background:/);
    expect(variablesSource).toMatch(/--composer-workspace-badge-background:/);
    expect(variablesSource).toMatch(/--sidebar-resize-indicator-color:/);
    expect(variablesSource).toMatch(/--bg-primary:\s*var\(--theme-bg-primary\);/);
    expect(variablesSource).toMatch(/--surface-shadow-lg:\s*var\(--theme-surface-shadow-lg\);/);
    expect(variablesSource).toMatch(/\[data-theme='light'\][\s\S]*--theme-warning-color:/i);
  });

  it('promotes settings_shared.css into the shared settings primitive layer', () => {
    const sharedSource = readFileSync(SETTINGS_SHARED_CSS_PATH, 'utf8');

    expect(sharedSource).toMatch(/\.primary-btn\s*\{/);
    expect(sharedSource).toMatch(/\.danger-btn\s*\{/);
    expect(sharedSource).toMatch(/\.card-header\s*\{/);
    expect(sharedSource).toMatch(/\.input-label input,/);
    expect(sharedSource).toMatch(/\.input-label select,/);
    expect(sharedSource).toMatch(/\.warning-text\s*\{/);
    expect(sharedSource).toMatch(/\.error-text\s*\{/);
    expect(sharedSource).toMatch(/\.tasks-empty\s*\{/);
    expect(sharedSource).toMatch(/\.task-status\s*\{/);
    expect(sharedSource).toMatch(/\.task-meta-label\s*\{/);
  });

  it('uses a shared custom settings select for dropdowns that need app-controlled expanded styling', () => {
    const settingsSelectSource = readFileSync(SETTINGS_SELECT_VUE_PATH, 'utf8');
    const usageSource = readFileSync(SETTINGS_USAGE_VUE_PATH, 'utf8');
    const speechSource = readFileSync(SETTINGS_SPEECH_VUE_PATH, 'utf8');
    const tasksSource = readFileSync(SETTINGS_TASKS_VUE_PATH, 'utf8');
    const memorySource = readFileSync(SETTINGS_MEMORY_VUE_PATH, 'utf8');
    const mcpSource = readFileSync(MCP_SETTINGS_VUE_PATH, 'utf8');
    const napcatSource = readFileSync(NAPCAT_SETTINGS_VUE_PATH, 'utf8');
    const providersSource = readFileSync(PROVIDERS_SETTINGS_VUE_PATH, 'utf8');
    const colorSchemeSource = readFileSync(SETTINGS_COLOR_SCHEME_VUE_PATH, 'utf8');
    const themeEditorModalSource = readFileSync(THEME_EDITOR_MODAL_VUE_PATH, 'utf8');
    const settingsViewSource = readFileSync(SETTINGS_VIEW_VUE_PATH, 'utf8');

    expect(settingsSelectSource).toMatch(/class="settings-select-trigger"/);
    expect(settingsSelectSource).toMatch(/class="settings-select-panel"/);
    expect(settingsSelectSource).toMatch(/settings-select-group-label/);
    expect(settingsSelectSource).toMatch(/aria-haspopup="listbox"/);
    expect(usageSource).toMatch(/<SettingsSelect/);
    expect(usageSource).not.toMatch(/<select v-model="usagePeriod"/);
    expect(speechSource).toMatch(/import SettingsSelect from/);
    expect(speechSource).not.toMatch(/<select/);
    expect(tasksSource).toMatch(/import SettingsSelect from/);
    expect(tasksSource).not.toMatch(/<select/);
    expect(memorySource).toMatch(/import SettingsSelect from/);
    expect(memorySource).not.toMatch(/<select/);
    expect(mcpSource).toMatch(/import SettingsSelect from/);
    expect(mcpSource).not.toMatch(/<select/);
    expect(napcatSource).toMatch(/import SettingsSelect from/);
    expect(napcatSource).not.toMatch(/<select/);
    expect(providersSource).toMatch(/import SettingsSelect from/);
    expect(providersSource).not.toMatch(/<select/);
    expect(colorSchemeSource).toMatch(/import ThemeEditorModal from/);
    expect(themeEditorModalSource).toMatch(/import SettingsSelect from/);
    expect(themeEditorModalSource).not.toMatch(/<select/);
    expect(colorSchemeSource).not.toMatch(/<select/);
    expect(settingsViewSource).toMatch(/import SettingsSelect from/);
    expect(settingsViewSource).toMatch(/toolModelSelectOptions/);
    expect(settingsViewSource).not.toMatch(/<select/);
  });

  it('migrates MCP, NapCat, Providers, and Life settings onto shared primitives and canonical tokens', () => {
    const mcpSource = readFileSync(MCP_SETTINGS_VUE_PATH, 'utf8');
    const napcatSource = readFileSync(NAPCAT_SETTINGS_VUE_PATH, 'utf8');
    const providersSource = readFileSync(PROVIDERS_SETTINGS_VUE_PATH, 'utf8');
    const lifeSource = readFileSync(SETTINGS_LIFE_VUE_PATH, 'utf8');
    const colorSchemeSource = readFileSync(SETTINGS_COLOR_SCHEME_VUE_PATH, 'utf8');
    const themeEditorModalSource = readFileSync(THEME_EDITOR_MODAL_VUE_PATH, 'utf8');
    const themePreviewSource = readFileSync(THEME_PREVIEW_VUE_PATH, 'utf8');
    const combinedColorSchemeSource = [
      colorSchemeSource,
      themeEditorModalSource,
      themePreviewSource,
    ].join('\n');

    expect(mcpSource).toMatch(/<style scoped src="\.\/settings_shared\.css"><\/style>/);
    expect(napcatSource).toMatch(/<style scoped src="\.\/settings_shared\.css"><\/style>/);
    expect(providersSource).toMatch(/<style scoped src="\.\/settings_shared\.css"><\/style>/);
    expect(lifeSource).toMatch(/<style scoped src="\.\/settings_shared\.css"><\/style>/);

    expect(mcpSource).not.toMatch(/\.secondary-btn\s*\{/);
    expect(mcpSource).not.toMatch(/var\(--warning-color,\s*#/);
    expect(mcpSource).not.toMatch(/var\(--danger-color,\s*#/);

    expect(napcatSource).not.toMatch(/#d18a32/);
    expect(napcatSource).not.toMatch(/#cc5a5a/);
    expect(napcatSource).not.toMatch(/\.reset-btn\s*\{/);

    expect(providersSource).toMatch(/provider-config-group/);
    expect(providersSource).not.toMatch(/class="secondary"/);
    expect(providersSource).not.toMatch(/class="primary"/);
    expect(providersSource).not.toMatch(/\.config-group\s*\{/);
    expect(providersSource).not.toMatch(/\.secondary-btn\s*\{/);
    expect(providersSource).not.toMatch(/#ef4444/);
    expect(providersSource).not.toMatch(/#22c55e/);
    expect(providersSource).not.toMatch(/\.icon-btn\s*\{/);
    expect(providersSource).toMatch(/surface-inset-highlight/);
    expect(providersSource).toMatch(/surface-shadow-lg/);
    expect(providersSource).not.toMatch(/var\(--accent-rgb,\s*0,\s*0,\s*0\)/);

    expect(lifeSource).not.toMatch(/--color-surface-elevated/);
    expect(lifeSource).not.toMatch(/--color-accent-primary/);
    expect(lifeSource).not.toMatch(/--color-text-secondary/);

    expect(combinedColorSchemeSource).toMatch(/surface-shadow-md/);
    expect(combinedColorSchemeSource).toMatch(/surface-shadow-lg/);
    expect(combinedColorSchemeSource).toMatch(/danger-color/);
    expect(combinedColorSchemeSource).toMatch(/warning-color/);
    expect(combinedColorSchemeSource).toMatch(/success-color/);
    expect(combinedColorSchemeSource).not.toMatch(
      /rgba\(var\(--accent-rgb,\s*96,\s*165,\s*250\)/
    );
    expect(combinedColorSchemeSource).not.toMatch(/background:\s*#ef4444/);
    expect(combinedColorSchemeSource).not.toMatch(/background:\s*#f59e0b/);
    expect(combinedColorSchemeSource).not.toMatch(/background:\s*#22c55e/);
  });

  it('styles enabled provider affordances with semantic status tokens', () => {
    const providersSource = readFileSync(PROVIDERS_SETTINGS_VUE_PATH, 'utf8');

    expect(providersSource).toMatch(/\.provider-status-dot\.enabled\s*\{/);
    expect(providersSource).toMatch(/\.status-badge\.enabled\s*\{/);
    expect(providersSource).toMatch(/var\(--status-success-color\)/);
  });

  it('keeps the custom provider modal viewport-safe with scrollable bounds', () => {
    const providersSource = readFileSync(PROVIDERS_SETTINGS_VUE_PATH, 'utf8');

    expect(providersSource).toMatch(
      /\.modal-overlay\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*padding:\s*24px;/i
    );
    expect(providersSource).toMatch(
      /\.modal-content\s*\{[\s\S]*max-height:\s*calc\(100vh - 48px\);[\s\S]*overflow:\s*hidden;[\s\S]*display:\s*flex;/i
    );
    expect(providersSource).toMatch(
      /\.provider-editor-scroll\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-width:\s*thin;/i
    );
  });

  it('centralizes app-shell text and selector affordances in globals.css', () => {
    const globalsSource = readFileSync(GLOBALS_CSS_PATH, 'utf8');

    expect(globalsSource).toMatch(/\.app-background\s*\{/);
    expect(globalsSource).toMatch(/\.app-text,\s*[\r\n]+\s*\.ui-text-primary\s*\{/);
    expect(globalsSource).toMatch(/\.ui-text-secondary\s*\{/);
    expect(globalsSource).toMatch(/\.ui-text-muted\s*\{/);
    expect(globalsSource).toMatch(/\.ui-text-accent\s*\{/);
    expect(globalsSource).toMatch(/\.ui-text-danger\s*\{/);
    expect(globalsSource).not.toMatch(/\.text-primary\s*\{/);
    expect(globalsSource).not.toMatch(/\.text-secondary\s*\{/);
    expect(globalsSource).not.toMatch(/\.text-muted\s*\{/);
    expect(globalsSource).not.toMatch(/\.text-accent\s*\{/);
    expect(globalsSource).not.toMatch(/\.text-danger\s*\{/);
    expect(globalsSource).toMatch(/\.composer-control-btn\s*\{/);
    expect(globalsSource).toMatch(/\.icon-btn:hover\s*\{/);
    expect(globalsSource).toMatch(/\.selector-badge\s*\{/);
  });

  it('removes local duplicate shell/text primitives and hardcoded badge colors from renderer consumers', () => {
    const chatInputSource = readFileSync(CHAT_INPUT_VUE_PATH, 'utf8');
    const chatComposerActionsSource = readFileSync(CHAT_COMPOSER_ACTIONS_VUE_PATH, 'utf8');
    const toolSelectorSource = readFileSync(TOOL_SELECTOR_VUE_PATH, 'utf8');
    const skillSelectorSource = readFileSync(SKILL_SELECTOR_VUE_PATH, 'utf8');
    const workspaceSelectorSource = readFileSync(WORKSPACE_SELECTOR_VUE_PATH, 'utf8');
    const welcomeScreenSource = readFileSync(WELCOME_SCREEN_VUE_PATH, 'utf8');
    const chatViewSource = readFileSync(CHAT_VIEW_VUE_PATH, 'utf8');

    expect(chatInputSource).toMatch(/ui-text-primary/);
    expect(chatInputSource).toMatch(/<WorkspaceSelector/);
    expect(chatInputSource).not.toMatch(/bg-\[#4a9eff\]/);
    expect(chatInputSource).not.toMatch(/\.icon-btn(?::hover|:disabled|\s*\{)/);
    expect(chatInputSource).not.toMatch(/rgba\(96,\s*165,\s*250/);
    expect(chatInputSource).not.toMatch(/rgba\(239,\s*68,\s*68/);
    expect(chatInputSource).not.toMatch(/color:\s*#ffffff;/);
    expect(chatInputSource).not.toMatch(/var\(--accent-rgb,\s*74,\s*158,\s*255\)/);
    expect(chatInputSource).not.toMatch(/model-selector-trigger composer-icon-btn/);

    expect(chatComposerActionsSource).toMatch(/ui-text-secondary/);
    expect(chatComposerActionsSource).toMatch(/ui-text-accent/);
    expect(chatComposerActionsSource).toMatch(/ui-text-danger/);
    expect(chatComposerActionsSource).toMatch(/ui-text-muted/);
    expect(chatComposerActionsSource).toMatch(/composer-icon-btn/);
    expect(chatComposerActionsSource).toMatch(/--chat-composer-send-background/);
    expect(chatComposerActionsSource).toMatch(/--chat-composer-stop-background/);
    expect(chatComposerActionsSource).not.toMatch(/bg-\[#4a9eff\]/);
    expect(chatComposerActionsSource).not.toMatch(/\.icon-btn(?::hover|:disabled|\s*\{)/);
    expect(chatComposerActionsSource).not.toMatch(/rgba\(96,\s*165,\s*250/);
    expect(chatComposerActionsSource).not.toMatch(/rgba\(239,\s*68,\s*68/);
    expect(chatComposerActionsSource).not.toMatch(/color:\s*#ffffff;/);
    expect(chatComposerActionsSource).not.toMatch(/var\(--accent-rgb,\s*74,\s*158,\s*255\)/);
    expect(workspaceSelectorSource).toMatch(/selector-badge/);
    expect(workspaceSelectorSource).toMatch(/composer-control-btn/);
    expect(workspaceSelectorSource).toMatch(/ui-text-secondary/);
    expect(workspaceSelectorSource).toMatch(/ui-text-accent/);

    expect(toolSelectorSource).toMatch(/ui-text-primary/);
    expect(toolSelectorSource).toMatch(/ui-text-secondary/);
    expect(toolSelectorSource).toMatch(/ui-text-muted/);
    expect(toolSelectorSource).toMatch(/ui-text-accent/);
    expect(toolSelectorSource).not.toMatch(/\.text-primary\s*\{/);
    expect(toolSelectorSource).not.toMatch(/\.text-secondary\s*\{/);
    expect(toolSelectorSource).not.toMatch(/\.text-muted\s*\{/);
    expect(toolSelectorSource).not.toMatch(/\.text-accent\s*\{/);
    expect(toolSelectorSource).not.toMatch(/\.icon-btn:hover\s*\{/);
    expect(toolSelectorSource).toMatch(/composer-control-btn/);
    expect(toolSelectorSource).toMatch(/composer-selector-trigger/);
    expect(toolSelectorSource).toMatch(/status-success-color/);
    expect(toolSelectorSource).toMatch(/status-danger-color/);

    expect(skillSelectorSource).toMatch(/ui-text-primary/);
    expect(skillSelectorSource).toMatch(/ui-text-secondary/);
    expect(skillSelectorSource).toMatch(/ui-text-muted/);
    expect(skillSelectorSource).toMatch(/ui-text-accent/);
    expect(skillSelectorSource).not.toMatch(/\.text-primary\s*\{/);
    expect(skillSelectorSource).not.toMatch(/\.text-secondary\s*\{/);
    expect(skillSelectorSource).not.toMatch(/\.text-muted\s*\{/);
    expect(skillSelectorSource).not.toMatch(/\.text-accent\s*\{/);
    expect(skillSelectorSource).not.toMatch(/\.icon-btn:hover\s*\{/);
    expect(skillSelectorSource).toMatch(/composer-control-btn/);
    expect(skillSelectorSource).toMatch(/composer-selector-trigger/);

    expect(welcomeScreenSource).toMatch(/ui-text-primary/);
    expect(welcomeScreenSource).toMatch(/ui-text-secondary/);
    expect(welcomeScreenSource).toMatch(/ui-text-muted/);
    expect(welcomeScreenSource).not.toMatch(/\.text-primary\s*\{/);
    expect(welcomeScreenSource).not.toMatch(/\.text-secondary\s*\{/);
    expect(welcomeScreenSource).not.toMatch(/\.text-muted\s*\{/);

    expect(chatViewSource).not.toMatch(/\.app-background\s*\{/);
    expect(chatViewSource).not.toMatch(/\.app-text\s*\{/);
    expect(chatViewSource).toMatch(/ui-text-secondary/);
    expect(chatViewSource).not.toMatch(/\.text-secondary\s*\{/);
    expect(chatViewSource).not.toMatch(/\.text-muted\s*\{/);
    expect(chatViewSource).not.toMatch(/var\(--reference-inline-underline,\s*rgba\(/);
  });

  it('avoids literal color fallbacks in shared accent and status affordances now that theme tokens are canonical', () => {
    const globalsSource = readFileSync(GLOBALS_CSS_PATH, 'utf8');
    const sharedSource = readFileSync(SETTINGS_SHARED_CSS_PATH, 'utf8');

    expect(globalsSource).not.toMatch(/var\(--accent-rgb,\s*74,\s*158,\s*255\)/);
    expect(sharedSource).not.toMatch(/var\(--success-color,\s*var\(--accent-color\)\)/);
  });

  it('removes hardcoded sidebar chrome colors in favor of shared primitives and tokens', () => {
    const sidebarSource = readFileSync(SIDEBAR_VUE_PATH, 'utf8');

    expect(sidebarSource).toMatch(/sidebar-shell/);
    expect(sidebarSource).toMatch(/sidebar-tool-btn icon-btn/);
    expect(sidebarSource).toMatch(/status-danger-color/);
    expect(sidebarSource).toMatch(/sidebar-resize-indicator-color/);
    expect(sidebarSource).not.toMatch(/text-gray-400/);
    expect(sidebarSource).not.toMatch(/hover:text-white/);
    expect(sidebarSource).not.toMatch(/hover:bg-blue-400\/50/);
    expect(sidebarSource).not.toMatch(/bg-gray-400\/50/);
    expect(sidebarSource).not.toMatch(/border-\[#fff\]/);
    expect(sidebarSource).not.toMatch(/#f87171/);
  });
});
