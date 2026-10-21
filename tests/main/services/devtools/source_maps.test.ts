import { describe, expect, it } from 'vitest';
import { SourceMapGenerator } from 'source-map-js';

import {
  mapBundledPosition,
  parseSourceMap,
  relativizeSource,
} from '../../../../packages/desktop/src/main/services/devtools/source_maps';

const ROOT = '/repo';

const buildMap = (source: string): string => {
  const generator = new SourceMapGenerator({ file: 'main_window.js' });
  generator.addMapping({
    generated: { line: 9, column: 2 },
    original: { line: 4, column: 6 },
    source,
  });
  return generator.toString();
};

describe('devtools source maps', () => {
  it('maps a bundled position back to the original file and line', () => {
    const mapped = mapBundledPosition(
      {
        scriptUrl: 'http://127.0.0.1:5173/main_window.js',
        mapText: buildMap('/repo/src/App.vue'),
        line: 9,
        column: 3,
      },
      ROOT
    );
    expect(mapped).toEqual({ source: 'src/App.vue', line: 4, column: 7 });
  });

  it('keeps sources outside the repo absolute instead of inventing a path', () => {
    const mapped = mapBundledPosition(
      {
        scriptUrl: 'http://127.0.0.1:5173/main_window.js',
        mapText: buildMap('/elsewhere/lib.js'),
        line: 9,
        column: 3,
      },
      ROOT
    );
    expect(mapped?.source).toBe('/elsewhere/lib.js');
  });

  it('returns null for a position the map does not cover', () => {
    expect(
      mapBundledPosition(
        {
          scriptUrl: 'http://x/main_window.js',
          mapText: buildMap('/repo/src/App.vue'),
          line: 2,
          column: 1,
        },
        ROOT
      )
    ).toBeNull();
  });

  it('returns null for a missing or malformed map rather than guessing', () => {
    expect(
      mapBundledPosition({ scriptUrl: 'http://x/a.js', mapText: null, line: 9, column: 3 }, ROOT)
    ).toBeNull();
    expect(
      mapBundledPosition(
        { scriptUrl: 'http://x/a.js', mapText: '{not json', line: 9, column: 3 },
        ROOT
      )
    ).toBeNull();
    expect(parseSourceMap('{"version":3}')).toBeNull();
  });

  it('unwraps the `/@fs/` prefix the dev server uses for repo files', () => {
    expect(relativizeSource('/@fs/repo/src/main.ts', ROOT)).toBe('src/main.ts');
    expect(relativizeSource('file:///repo/src/main.ts', ROOT)).toBe('src/main.ts');
    expect(relativizeSource('../shared/x.ts', ROOT)).toBe('../shared/x.ts');
  });
});
