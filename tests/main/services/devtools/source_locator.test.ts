import { describe, expect, it } from 'vitest';

import {
  buildInstallRecorderExpression,
  buildProbeExpression,
  buildScriptUrlExpression,
  cleanComponentFile,
} from '../../../../packages/desktop/src/main/services/devtools/source_locator';

const evaluate = (expression: string, scope: Record<string, unknown> = {}) => {
  const names = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  const run = new Function(...names, `return ${expression};`);
  return run(...names.map(name => scope[name]));
};

describe('devtools source locator', () => {
  it('emits syntactically valid probe and recorder expressions', () => {
    expect(() => new Function(`return ${buildProbeExpression({})};`)).not.toThrow();
    expect(() => new Function(`return ${buildInstallRecorderExpression()};`)).not.toThrow();
    expect(() => new Function(`return ${buildScriptUrlExpression()};`)).not.toThrow();
  });

  it('embeds the selector as data, not as code', () => {
    const expression = buildProbeExpression({ target: 'selector', selector: `a"]);9;("` });
    expect(expression).toContain(JSON.stringify(`a"]);9;("`));
    expect(() => new Function(`return ${expression};`)).not.toThrow();
  });

  it('defaults to the last-clicked element', () => {
    expect(buildProbeExpression({})).toContain('__ikiDevToolsSelected');
    expect(buildProbeExpression({ target: 'hovered' })).toContain('__ikiDevToolsHovered');
  });

  it('reports no click recorded instead of throwing', () => {
    const result = evaluate(buildProbeExpression({}), {
      window: {},
      document: { querySelector: () => null },
      CSS: { escape: (value: string) => value },
    });
    expect(result).toEqual({ ok: false, reason: 'no-selected-element' });
  });

  it('reports a missing selector target', () => {
    const result = evaluate(buildProbeExpression({ target: 'selector', selector: '.nope' }), {
      window: {},
      document: { querySelector: () => null },
      CSS: { escape: (value: string) => value },
    });
    expect(result).toEqual({ ok: false, reason: 'selector-not-found' });
  });

  it('strips Vite query strings from component files', () => {
    expect(cleanComponentFile('/repo/src/components/A.vue?vue&type=template&id=ab12')).toBe(
      '/repo/src/components/A.vue'
    );
    expect(cleanComponentFile('/repo/src/components/A.vue')).toBe('/repo/src/components/A.vue');
  });

  it('reports no element at a probed point', () => {
    const result = evaluate(buildProbeExpression({ target: 'point', point: [10, 20] }), {
      window: {},
      document: { elementFromPoint: () => null },
      CSS: { escape: (value: string) => value },
    });
    expect(result).toEqual({ ok: false, reason: 'no-element-at-point' });
  });

  describe('component chain walk', () => {
    const scope = (element: Record<string, unknown>) => ({
      window: {
        __ikiDevToolsSelected: element,
        __ikiDevToolsHovered: element,
        CSS: { escape: (value: string) => value },
      },
      document: {
        querySelector: () => element,
        elementFromPoint: () => element,
        body: { tagName: 'BODY' },
        documentElement: { tagName: 'HTML' },
      },
    });

    const element = (instance: unknown) => ({
      nodeType: 1,
      tagName: 'DIV',
      id: '',
      classList: ['chat-input'],
      parentElement: null,
      isConnected: true,
      textContent: 'Ask first zcode/GLM-5.3-Flash',
      getBoundingClientRect: () => ({ top: 600, left: 100, bottom: 660, right: 400 }),
      __vueParentComponent: instance,
    });

    const internal = (file: string, name: string, parent: unknown) => ({
      type: { __file: file, __name: name },
      proxy: { $options: { __file: file, name } },
      parent,
      setupState: {},
    });

    it('names dev-build components from the internal instance shape', () => {
      const app = internal('/repo/src/renderer/App.vue?vue&type=style&index=0', 'App', null);
      const view = internal('/repo/src/renderer/views/ChatView.vue', 'ChatView', app);
      const input = internal(
        '/repo/src/renderer/components/ChatInput.vue?t=1729430000000',
        'ChatInput',
        view
      );

      const result = evaluate(buildProbeExpression({}), scope(element(input)));

      expect(result.ok).toBe(true);
      expect(result.locator.components).toEqual([
        '/repo/src/renderer/components/ChatInput.vue',
        '/repo/src/renderer/views/ChatView.vue',
        '/repo/src/renderer/App.vue',
      ]);
      expect(result.locator.ownerFile).toBe('/repo/src/renderer/components/ChatInput.vue');
      expect(result.locator.text).toContain('Ask first');
      expect(result.locator.box).toEqual([600, 100, 660, 400]);
    });

    it('reads a public instance that only exposes $options', () => {
      const home = {
        $options: { __file: '/repo/src/views/Home.vue', name: 'Home' },
        parent: null,
        setupState: {},
      };

      const result = evaluate(
        buildProbeExpression({ target: 'selector', selector: '.x' }),
        scope(element(home))
      );

      expect(result.locator.components).toEqual(['/repo/src/views/Home.vue']);
    });

    it('falls back to the component name when no file was kept', () => {
      const instance = { type: { name: 'RouterView' }, parent: null, setupState: {} };

      const result = evaluate(buildProbeExpression({}), scope(element(instance)));

      expect(result.locator.components).toEqual(['RouterView']);
      expect(result.locator.ownerFile).toBeUndefined();
    });

    it('answers with an empty chain for a non-Vue element', () => {
      const result = evaluate(
        buildProbeExpression({ target: 'point', point: [420, 260] }),
        scope(element(null))
      );

      expect(result.ok).toBe(true);
      expect(result.locator.components).toEqual([]);
      expect(result.locator.ownerFile).toBeUndefined();
    });
  });
});
