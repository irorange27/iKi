import { z } from 'zod';

import { BaseTool } from '@iki/backend/tools/base';
import type { DevToolsResolveRequest, DevToolsSourceResult } from '@iki/backend/types/devtools';
import { ElementSourceInputSchema } from './schemas';

/**
 * The desktop main process owns the renderer probe (`window.electronAPI`).
 * The tool runs in an agent context that may live in the daemon, which has no
 * windows at all, so the resolver is injected at registration instead of
 * imported — backend must not reach into desktop.
 */
export type ElementSourceResolver = (
  request: DevToolsResolveRequest
) => Promise<DevToolsSourceResult> | DevToolsSourceResult;

let elementSourceResolver: ElementSourceResolver | null = null;

export const setElementSourceResolver = (resolver: ElementSourceResolver | null): void => {
  elementSourceResolver = resolver;
};

const NO_BRIDGE_HINT =
  'No UI window is reachable (this runtime has no desktop renderer, or the bridge is not registered).';

const MISSING_POINT_HINT =
  '`x` and `y` (viewport CSS pixels) are required when target is `point`.';

export class ElementSourceTool extends BaseTool {
  override name = 'element_source';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  // A probe against the renderer: it reads the component chain, it does not
  // drive the UI. (It records the last-selected element, which a second probe
  // overwrites with the same observation.)
  override replay = 'safe' as const;
  override description =
    'Locate the source file that renders a UI element in the running app window — the "I see it on screen, where is the code?" step. Use `selected` after the user clicks the element in the app (or after opening DevTools with F12 and clicking it), `hovered` for the element under the pointer, `selector` with a CSS selector, or `point` with the `x`/`y` viewport pixel of something you can see in a screenshot. Returns the Vue component chain (component name + source file path), the owning .vue file, and often the line. Read that file before editing; do not guess a path.';

  override paramSchema = ElementSourceInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    if (!elementSourceResolver) {
      return { ok: false, reason: NO_BRIDGE_HINT };
    }
    if (args.target === 'selector' && !args.selector?.trim()) {
      return { ok: false, reason: '`selector` is required when target is `selector`.' };
    }
    if (args.target === 'point' && (args.x === undefined || args.y === undefined)) {
      return { ok: false, reason: MISSING_POINT_HINT };
    }
    const result = await elementSourceResolver({
      target: args.target,
      ...(args.target === 'selector' ? { selector: args.selector?.trim() } : {}),
      ...(args.target === 'point' ? { point: [args.x as number, args.y as number] } : {}),
    });
    if (!result.ok && result.reason === 'no-selected-element') {
      return {
        ...result,
        reason:
          'Nothing recorded yet: click the element in the app window first (the click recorder is installed on the first probe), then retry, or pass `target: "hovered"` / a CSS `selector`.',
      };
    }
    return result;
  }
}
