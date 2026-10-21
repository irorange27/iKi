// The desktop app runs the daemon *embedded* — `startEmbeddedDaemon()` calls
// `startDaemonServer()` in the same process as the main process, so both share
// one module registry and one `defaultToolRegistry`. Main registers first, with
// the renderer probe; the daemon registers second, with nothing. `registerStandardTools`
// used to do `setElementSourceResolver(resolver ?? null)`, so the daemon's
// registration silently wiped main's resolver and the in-app `element_source`
// tool answered "No UI window is reachable" in every desktop session — even
// though the probe, the IPC channel and the preload bridge were all fine.
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

    // The embedded daemon's own registration: no resolver to offer.
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
