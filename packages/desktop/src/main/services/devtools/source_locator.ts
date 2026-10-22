

export type DevToolsProbeTarget = 'selected' | 'hovered' | 'selector' | 'point';

const cssString = (value: string): string => JSON.stringify(value);

const normalizeTarget = (target: unknown): DevToolsProbeTarget =>
  target === 'hovered' || target === 'selector' || target === 'point' ? target : 'selected';

const normalizePoint = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
};

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

export const buildInstallRecorderExpression = (): string => `(() => {
  const win = window;
  if (win.__ikiDevToolsRecorderInstalled) return 'already-installed';
  win.__ikiDevToolsRecorderInstalled = true;
  const record = (key) => (event) => {
    const target = event.target;
    win[key] = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
  };
  win.addEventListener('pointerdown', record('__ikiDevToolsSelected'), { capture: true, passive: true });
  win.addEventListener('click', record('__ikiDevToolsSelected'), { capture: true, passive: true });
  win.addEventListener('pointerover', record('__ikiDevToolsHovered'), { capture: true, passive: true });
  return 'installed';
})()`;

export const buildScriptUrlExpression = (): string => `(() => {
  const script = document.querySelector('script[type="module"][src], script[src]');
  return script && script.src ? script.src : '';
})()`;

export const cleanComponentFile = (value: string): string => {
  const queryAt = value.indexOf('?');
  return queryAt === -1 ? value : value.slice(0, queryAt);
};
