import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MAIN_WINDOW_PATH = resolve(process.cwd(), 'src/main/windows/main_window.ts');
const SETTINGS_WINDOW_PATH = resolve(process.cwd(), 'src/main/windows/settings_window.ts');

describe('window shell defaults', () => {
  it('boots frameless windows with explicit shell colors and defers shadow opt-in to the renderer', () => {
    const mainSource = readFileSync(MAIN_WINDOW_PATH, 'utf8');
    const settingsSource = readFileSync(SETTINGS_WINDOW_PATH, 'utf8');

    expect(mainSource).toMatch(/backgroundColor:\s*'#2a2d35'/);
    expect(settingsSource).toMatch(/backgroundColor:\s*'#2a2d35'/);
    expect(mainSource).toMatch(/hasShadow:\s*false/);
    expect(settingsSource).toMatch(/hasShadow:\s*false/);
    expect(mainSource).not.toMatch(/vibrancy:\s*['"]/);
    expect(settingsSource).not.toMatch(/vibrancy:\s*['"]/);
  });
});
