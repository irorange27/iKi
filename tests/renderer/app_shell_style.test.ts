import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_VUE_PATH = resolve(process.cwd(), 'src/renderer/App.vue');

describe('renderer app shell styles', () => {
  it('uses full-bleed background without legacy 40px root radius', () => {
    const source = readFileSync(APP_VUE_PATH, 'utf8');

    expect(source).not.toMatch(/border-radius:\s*40px/i);
    expect(source).toMatch(
      /html,\s*body,\s*#app,\s*\.app-container\s*\{[\s\S]*background-color:\s*var\(--bg-primary\);/i
    );
  });
});
