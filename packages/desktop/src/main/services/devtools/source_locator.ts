/**
 * Element → source: the "click it in the app, get the file and line back"
 * half of the DevTools workflow. Pure helpers only (no Electron import) so the
 * probe expression and the sourcemap hop can be unit-tested under vitest.
 */

export type DevToolsProbeTarget = 'selected' | 'hovered' | 'selector' | 'point';

const cssString = (value: string): string => JSON.stringify(value);

const normalizeTarget = (target: unknown): DevToolsProbeTarget =>
  target === 'hovered' || target === 'selector' || target === 'point' ? target : 'selected';

/** A viewport coordinate pair, defensively read from an IPC payload. */
const normalizePoint = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
};

/**
 * The page-side half of the probe, evaluated inside the renderer. DevTools'
 * own "inspect" mode records `$0` only in the DevTools world, never in the
 * page, so `selected` falls back to the last element whose click was captured
 * by the capture-phase listener installed here (see the recorder below).
 */
export const buildProbeExpression = (input: {
  target?: unknown;
  selector?: unknown;
  point?: unknown;
}): string => {
  const target = normalizeTarget(input.target);
  const selector = typeof input.selector === 'string' ? input.selector : '';
  const point = normalizePoint(input.point);
  return `(() => {
  const TARGET = ${cssString(target)};
  const SELECTOR = ${cssString(selector)};
  const POINT = ${point ? `[${point[0]}, ${point[1]}]` : 'null'};
  const win = window;

  const escapeId = (value) => (win.CSS && win.CSS.escape ? win.CSS.escape(value) : value.replace(/([^a-zA-Z0-9_-])/g, '\\\\$1'));
  const cssPath = (element) => {
    if (!element || !element.tagName) return '';
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && parts.length < 12) {
      if (current === document.body || current === document.documentElement) {
        parts.unshift(current.tagName.toLowerCase());
        break;
      }
      if (current.id) {
        parts.unshift('#' + escapeId(current.id));
        break;
      }
      let part = current.tagName.toLowerCase();
      if (current.classList && current.classList.length) {
        part += '.' + [...current.classList].slice(0, 2).map(escapeId).join('.');
      }
      const parent = current.parentElement;
      if (parent) {
        const same = [...parent.children].filter((sibling) => sibling.tagName === current.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(current) + 1) + ')';
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ');
  };

  const unref = (value) => {
    if (!value) return null;
    if (Array.isArray(value)) return unref(value[0]);
    if (value.__v_isRef) return unref(value.value);
    return typeof value === 'object' || typeof value === 'function' ? value : null;
  };

  // __vueParentComponent is the *internal* instance: it has no $options.
  // __vueParentComponent is the *internal* instance: it has no $options.
  // The definition lives on .type (dev + prod), the public instance on
  // .proxy.$options; reading only $options walked the chain and pushed
  const optionsOf = (component) => {
    if (!component) return null;
    if (component.$options) return component.$options;
    if (component.proxy && component.proxy.$options) return component.proxy.$options;
    return component.type || null;
  };

  const fileOf = (component) => {
    const options = optionsOf(component);
    const file = options && (options.__file || options.__name || options.name);
    if (typeof file !== 'string' || file.indexOf('.') === -1) return undefined;
    // HMR re-imports append ?t=<ts> to the module id, so __file can carry a
    // Vite query even though the on-disk file has none.
    const queryAt = file.search(/[?#]/);
    return queryAt === -1 ? file : file.slice(0, queryAt);
  };

  const nameOf = (component) => {
    const options = optionsOf(component);
    return (options && (options.name || options.__name)) || '';
  };

  const componentChain = (instance) => {
    const out = [];
    let current = instance;
    let depth = 0;
    while (current && depth < 12) {
      const file = fileOf(current);
      const name = nameOf(current);
      if (file || name) out.push(file || name);
      current = current.parent || null;
      depth++;
    }
    return out;
  };

  const ownerOf = (instance) => {
    let current = instance;
    let depth = 0;
    while (current && depth < 12) {
      const file = fileOf(current);
      if (file) return file;
      current = current.parent || null;
      depth++;
    }
    return undefined;
  };

  // v-for compiles to renderList and Vue keeps no source expression on the
  // instance. The collection it walked is still reachable as the single
  // non-private array of objects on the nearest setupState — enough of a hint
  // to grep the template for it.
  const vForOf = (instance) => {
    let current = instance;
    let depth = 0;
    while (current && depth < 12) {
      const setup = current.setupState || {};
      const names = Object.keys(setup).filter((key) => {
        if (key.charAt(0) === '_' || key.charAt(0) === '$') return false;
        const value = unref(setup[key]);
        return Array.isArray(value) && value.length > 0 && typeof value[0] === 'object';
      });
      if (names.length === 1) return names[0];
      if (names.length > 1) return names.slice(0, 3).join('|');
      current = current.parent || null;
      depth++;
    }
    return undefined;
  };

  let element = null;
  if (TARGET === 'selector') {
    element = SELECTOR ? document.querySelector(SELECTOR) : null;
    if (!element) return { ok: false, reason: 'selector-not-found' };
  } else if (TARGET === 'point') {
    // No click or hover needed: the caller has viewport coordinates (the CDP
    // twin, or a model that read a position off a screenshot).
    element = POINT ? document.elementFromPoint(POINT[0], POINT[1]) : null;
    if (!element) return { ok: false, reason: 'no-element-at-point' };
  } else if (TARGET === 'hovered') {
    element = win.__ikiDevToolsHovered && win.__ikiDevToolsHovered.isConnected ? win.__ikiDevToolsHovered : null;
    if (!element) return { ok: false, reason: 'no-hovered-element' };
  } else {
    element = win.__ikiDevToolsSelected && win.__ikiDevToolsSelected.isConnected ? win.__ikiDevToolsSelected : null;
    if (!element) return { ok: false, reason: 'no-selected-element' };
  }

  const instance = element.__vueParentComponent || null;
  const rect = element.getBoundingClientRect();
  return {
    ok: true,
    locator: {
      selector: cssPath(element),
      tag: element.tagName.toLowerCase(),
      components: componentChain(instance),
      ownerFile: ownerOf(instance),
      vFor: vForOf(instance),
      text: (element.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
      box: [Math.round(rect.top), Math.round(rect.left), Math.round(rect.bottom), Math.round(rect.right)],
    },
  };
})()`;
};

/**
 * Install the click/hover recorders once per renderer document. `selected`
 * then means "the element the user last clicked in the app"; without it a
 * probe right after a click would find nothing.
 */
export const buildInstallRecorderExpression = (): string => `(() => {
  const win = window;
  if (win.__ikiDevToolsRecorderInstalled) return 'already-installed';
  win.__ikiDevToolsRecorderInstalled = true;
  const record = (key) => (event) => {
    const target = event.target;
    win[key] = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
  };
  // Capture phase on window runs before every component handler, including
  // components that stop propagation for their own children.
  win.addEventListener('pointerdown', record('__ikiDevToolsSelected'), { capture: true, passive: true });
  win.addEventListener('click', record('__ikiDevToolsSelected'), { capture: true, passive: true });
  win.addEventListener('pointerover', record('__ikiDevToolsHovered'), { capture: true, passive: true });
  return 'installed';
})()`;

/**
 * The first module script is the app bundle (Vite injects a single
 * `<script type="module" src="...">` entry). CDP reports positions against
 * that script, so it names the sourcemap to consult.
 */
export const buildScriptUrlExpression = (): string => `(() => {
  const script = document.querySelector('script[type="module"][src], script[src]');
  return script && script.src ? script.src : '';
})()`;

/** Strip a Vite query (`?vue&type=template&...`) from `__file` values. */
export const cleanComponentFile = (value: string): string => {
  const queryAt = value.indexOf('?');
  return queryAt === -1 ? value : value.slice(0, queryAt);
};
