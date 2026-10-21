import { afterEach, describe, expect, it } from 'vitest';

import {
  ElementSourceTool,
  setElementSourceResolver,
} from '@iki/backend/tools/element_source_tool';
import type { DevToolsResolveRequest } from '@iki/backend/types/devtools';

const run = async (input: Record<string, unknown>) => {
  const tool = new ElementSourceTool();
  return (tool as unknown as { handler: (value: unknown) => Promise<unknown> }).handler(input);
};

afterEach(() => setElementSourceResolver(null));

describe('element_source tool', () => {
  it('says which runtime has no window instead of throwing', async () => {
    await expect(run({ target: 'selected' })).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('No UI window'),
    });
  });

  it('forwards the request to the injected resolver', async () => {
    const seen: DevToolsResolveRequest[] = [];
    setElementSourceResolver(request => {
      seen.push(request);
      return { ok: true, locator: { selector: 'div', tag: 'div', components: [] } };
    });

    const result = await run({ target: 'selector', selector: '  .chat-message  ' });

    expect(seen).toEqual([{ target: 'selector', selector: '.chat-message' }]);
    expect(result).toMatchObject({ ok: true });
  });

  it('refuses a selector target without a selector', async () => {
    setElementSourceResolver(() => ({ ok: true }));
    await expect(run({ target: 'selector' })).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('`selector` is required'),
    });
  });

  it('turns an empty recording into the next step for the model', async () => {
    setElementSourceResolver(() => ({ ok: false, reason: 'no-selected-element' }));
    const result = (await run({ target: 'selected' })) as { ok: boolean; reason: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('click the element in the app window first');
  });

  it('addresses a viewport point for the resolver', async () => {
    const seen: DevToolsResolveRequest[] = [];
    setElementSourceResolver(request => {
      seen.push(request);
      return {
        ok: true,
        locator: {
          selector: 'div.chat-input',
          tag: 'div',
          components: ['/repo/packages/desktop/src/renderer/components/ChatInput.vue'],
          ownerFile: '/repo/packages/desktop/src/renderer/components/ChatInput.vue',
        },
      };
    });

    const result = (await run({ target: 'point', x: 120, y: 620 })) as {
      ok: boolean;
      locator?: { components: string[] };
    };

    expect(seen).toEqual([{ target: 'point', point: [120, 620] }]);
    expect(result.locator?.components[0]).toContain('ChatInput.vue');
  });

  it('refuses a point target without both coordinates', async () => {
    setElementSourceResolver(() => ({ ok: true }));
    await expect(run({ target: 'point', x: 120 })).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('required when target is `point`'),
    });
  });

  it('exposes every targeting mode in the model-facing schema', () => {
    const tool = new ElementSourceTool();
    const json = tool.parameters as {
      properties?: Record<string, { enum?: string[]; type?: string }>;
    };

    expect(Object.keys(json.properties ?? {}).sort()).toEqual(
      ['description', 'selector', 'target', 'x', 'y'].sort()
    );
    expect(json.properties?.target?.enum).toEqual(['selected', 'hovered', 'selector', 'point']);
    expect(json.properties?.x?.type).toBe('integer');
    expect(json.properties?.y?.type).toBe('integer');
    expect(tool.description).toContain('screenshot');
  });
});
