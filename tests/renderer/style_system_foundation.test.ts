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
const CHAT_INPUT_VUE_PATH = resolve(process.cwd(), 'src/renderer/components/ChatInput.vue');
const TOOL_SELECTOR_VUE_PATH = resolve(process.cwd(), 'src/renderer/components/ToolSelector.vue');
const SKILL_SELECTOR_VUE_PATH = resolve(process.cwd(), 'src/renderer/components/SkillSelector.vue');
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
    expect(variablesSource).toMatch(/\[data-theme='light'\][\s\S]*--warning-color:/i);
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
  });

  it('migrates MCP, NapCat, and Providers settings onto shared primitives and canonical tokens', () => {
    const mcpSource = readFileSync(MCP_SETTINGS_VUE_PATH, 'utf8');
    const napcatSource = readFileSync(NAPCAT_SETTINGS_VUE_PATH, 'utf8');
    const providersSource = readFileSync(PROVIDERS_SETTINGS_VUE_PATH, 'utf8');

    expect(mcpSource).toMatch(/<style scoped src="\.\/settings_shared\.css"><\/style>/);
    expect(napcatSource).toMatch(/<style scoped src="\.\/settings_shared\.css"><\/style>/);
    expect(providersSource).toMatch(/<style scoped src="\.\/settings_shared\.css"><\/style>/);

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
    const toolSelectorSource = readFileSync(TOOL_SELECTOR_VUE_PATH, 'utf8');
    const skillSelectorSource = readFileSync(SKILL_SELECTOR_VUE_PATH, 'utf8');
    const welcomeScreenSource = readFileSync(WELCOME_SCREEN_VUE_PATH, 'utf8');
    const chatViewSource = readFileSync(CHAT_VIEW_VUE_PATH, 'utf8');

    expect(chatInputSource).toMatch(/ui-text-primary/);
    expect(chatInputSource).toMatch(/ui-text-secondary/);
    expect(chatInputSource).toMatch(/ui-text-accent/);
    expect(chatInputSource).toMatch(/ui-text-danger/);
    expect(chatInputSource).toMatch(/ui-text-muted/);
    expect(chatInputSource).toMatch(/composer-icon-btn/);
    expect(chatInputSource).toMatch(/composer-attach-btn/);
    expect(chatInputSource).toMatch(/selector-badge/);
    expect(chatInputSource).toMatch(/--chat-composer-send-background/);
    expect(chatInputSource).toMatch(/--chat-composer-stop-background/);
    expect(chatInputSource).not.toMatch(/bg-\[#4a9eff\]/);
    expect(chatInputSource).not.toMatch(/\.icon-btn(?::hover|:disabled|\s*\{)/);
    expect(chatInputSource).not.toMatch(/rgba\(96,\s*165,\s*250/);
    expect(chatInputSource).not.toMatch(/rgba\(239,\s*68,\s*68/);
    expect(chatInputSource).not.toMatch(/color:\s*#ffffff;/);
    expect(chatInputSource).not.toMatch(/model-selector-trigger composer-icon-btn/);

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
