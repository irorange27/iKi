import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_VUE_PATH = resolve(process.cwd(), 'src/renderer/App.vue');
const CHAT_VIEW_VUE_PATH = resolve(process.cwd(), 'src/renderer/views/ChatView.vue');
const SETTINGS_VIEW_VUE_PATH = resolve(process.cwd(), 'src/renderer/views/SettingsView.vue');
const VARIABLES_CSS_PATH = resolve(process.cwd(), 'src/renderer/assets/styles/variables.css');

describe('renderer app shell styles', () => {
  it('uses full-bleed background without legacy 40px root radius', () => {
    const source = readFileSync(APP_VUE_PATH, 'utf8');

    expect(source).not.toMatch(/border-radius:\s*40px/i);
    expect(source).toMatch(
      /html,\s*body,\s*#app,\s*\.app-container\s*\{[\s\S]*background-color:\s*var\(--bg-primary\);/i
    );
  });

  it('routes frameless shell chrome through theme tokens with light-theme edge treatment', () => {
    const appSource = readFileSync(APP_VUE_PATH, 'utf8');
    const variablesSource = readFileSync(VARIABLES_CSS_PATH, 'utf8');

    expect(variablesSource).toMatch(/--app-shell-border-color:/);
    expect(variablesSource).toMatch(/--app-shell-shadow:/);
    expect(variablesSource).toMatch(
      /\[data-theme='light'\][\s\S]*--app-shell-border-color:[\s\S]*--app-shell-shadow:/i
    );
    expect(appSource).toMatch(/border:\s*1px solid var\(--app-shell-border-color\);/);
    expect(appSource).toMatch(/box-shadow:\s*var\(--app-shell-shadow\);/);
  });

  it('sizes chat and settings views from the app shell instead of viewport height', () => {
    const chatSource = readFileSync(CHAT_VIEW_VUE_PATH, 'utf8');
    const settingsSource = readFileSync(SETTINGS_VIEW_VUE_PATH, 'utf8');

    expect(chatSource).not.toMatch(/\bh-screen\b/);
    expect(chatSource).toMatch(/class="flex h-full min-h-0 app-background app-text"/);
    expect(chatSource).toMatch(/class="flex min-h-0 flex-1 flex-col"/);
    expect(settingsSource).not.toMatch(/height:\s*100vh/);
    expect(settingsSource).not.toMatch(/calc\(100vh/i);
    expect(settingsSource).toMatch(/\.settings-container\s*\{[\s\S]*height:\s*100%;/i);
    expect(settingsSource).toMatch(/\.settings-nav\s*\{[\s\S]*min-height:\s*0;/i);
    expect(settingsSource).toMatch(/\.settings-content\s*\{[\s\S]*min-height:\s*0;/i);
  });
});
