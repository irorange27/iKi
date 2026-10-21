import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerStandardTools } from '@iki/backend/tools';
import {
  ElementSourceTool,
  setElementSourceResolver,
} from '@iki/backend/tools/element_source_tool';
import type { DevToolsResolveRequest } from '@iki/backend/types/devtools';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';
import { startPiTurnHarness } from '@iki/backend/agent/harness';
import { getToolModel } from '@iki/backend/provider/tool_model';

const runtime = {
  delegatedAgentRuntime: {
    createRunTracker: createAgentRunTracker,
    getConversationToolModel: getToolModel,
    createHarness: startPiTurnHarness,
  },
};

const ask = async (input: Record<string, unknown>) => {
  const tool = new ElementSourceTool();
  return (tool as unknown as { handler: (value: unknown) => Promise<unknown> }).handler(input);
};

afterEach(() => setElementSourceResolver(null));

describe('element_source resolver survives re-registration', () => {
  it('keeps the probe installed when a later registration passes no resolver', async () => {
    const seen: DevToolsResolveRequest[] = [];
    registerStandardTools({
      ...runtime,
      elementSourceResolver: request => {
        seen.push(request);
        return {
          ok: true,
          locator: {
            selector: 'div.composer-toolbar',
            tag: 'div',
            components: ['/repo/packages/desktop/src/renderer/components/ChatInput.vue'],
          },
        };
      },
    });

    registerStandardTools(runtime);

    const result = (await ask({ target: 'point', x: 120, y: 620 })) as {
      ok: boolean;
      reason?: string;
      locator?: { components: string[] };
    };

    expect(result.ok).toBe(true);
    expect(seen).toEqual([{ target: 'point', point: [120, 620] }]);
    expect(result.locator?.components[0]).toContain('ChatInput.vue');
  });

  it('still refuses when nothing ever installed a resolver', async () => {
    registerStandardTools(runtime);

    await expect(ask({ target: 'selected' })).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('No UI window'),
    });
  });

  it('honours an explicit removal', async () => {
    registerStandardTools({ ...runtime, elementSourceResolver: () => ({ ok: true }) });
    setElementSourceResolver(null);

    await expect(ask({ target: 'selected' })).resolves.toMatchObject({ ok: false });
  });

  it('lets a later registration replace the resolver', async () => {
    const first = vi.fn(() => ({ ok: true, reason: 'from-first' }));
    const second = vi.fn(() => ({ ok: true, reason: 'from-second' }));

    registerStandardTools({ ...runtime, elementSourceResolver: first });
    registerStandardTools({ ...runtime, elementSourceResolver: second });

    await ask({ target: 'selected' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
