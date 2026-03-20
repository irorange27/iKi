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

describe('renderer style system foundation', () => {
  it('loads renderer theme tokens from globals.css instead of App.vue or a second palette', () => {
    const globalsSource = readFileSync(GLOBALS_CSS_PATH, 'utf8');
    const appSource = readFileSync(APP_VUE_PATH, 'utf8');

    expect(globalsSource).toMatch(/@import '\.\/variables\.css';/);
    expect(appSource).not.toMatch(/@import '\.\/assets\/styles\/variables\.css';/);
    expect(globalsSource).not.toMatch(/:root\s*\{[\s\S]*--background:/);
    expect(globalsSource).not.toMatch(/\.dark\s*\{/);
  });

  it('defines canonical semantic tokens for warning, radii, and accent contrast in variables.css', () => {
    const variablesSource = readFileSync(VARIABLES_CSS_PATH, 'utf8');

    expect(variablesSource).toMatch(/--warning-color:/);
    expect(variablesSource).toMatch(/--accent-contrast:/);
    expect(variablesSource).toMatch(/--radius-base:/);
    expect(variablesSource).toMatch(/--surface-radius:/);
    expect(variablesSource).toMatch(/--control-radius:/);
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
  });
});
