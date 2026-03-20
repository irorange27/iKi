import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_VUE_PATH = resolve(process.cwd(), 'src/renderer/App.vue');
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
});
