import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MAIN_WINDOW_PATH = resolve(process.cwd(), 'src/main/windows/main_window.ts');
const SETTINGS_WINDOW_PATH = resolve(process.cwd(), 'src/main/windows/settings_window.ts');
const THEME_BOOTSTRAP_PATH = resolve(process.cwd(), 'src/main/windows/theme_bootstrap.ts');

describe('window shell defaults', () => {
  it('boots frameless windows from the resolved theme preset and defers shadow opt-in to the renderer', () => {
    const mainSource = readFileSync(MAIN_WINDOW_PATH, 'utf8');
    const settingsSource = readFileSync(SETTINGS_WINDOW_PATH, 'utf8');
    const bootstrapSource = readFileSync(THEME_BOOTSTRAP_PATH, 'utf8');

    expect(mainSource).toMatch(/backgroundColor:\s*resolveWindowBootstrapBackgroundColor\(\)/);
    expect(settingsSource).toMatch(/backgroundColor:\s*resolveWindowBootstrapBackgroundColor\(\)/);
    expect(bootstrapSource).toMatch(/resolveThemeSelection/);
    expect(mainSource).toMatch(/hasShadow:\s*false/);
    expect(settingsSource).toMatch(/hasShadow:\s*false/);
    expect(mainSource).not.toMatch(/vibrancy:\s*['"]/);
    expect(settingsSource).not.toMatch(/vibrancy:\s*['"]/);
  });
});
