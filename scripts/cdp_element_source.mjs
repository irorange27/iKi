#!/usr/bin/env node
// Element → source, over CDP. Answers "which file renders the element I am
// looking at?" and prints `path:line`, ready to hand to an editor or an agent.
//
// The probe runs inside the page (Vue keeps `__vueParentComponent` on every
// element it rendered) and the answer is turned into a repo-relative file by
// the app's own main process (`devtools:probe-element`), which also owns the
// sourcemap hop for the exact line. This script is the command-line twin of the
// `element_source` tool, for driving it by hand instead of through the model.
//
// Usage:
//   pnpm run app:debug                                  # app with CDP on 9222
//   pnpm run elem-source -- --click                     # next element you click in the app
//   pnpm run elem-source -- --hovered                   # element the pointer is over
//   pnpm run elem-source -- --selector ".chat-message"
//   pnpm run elem-source -- --x 420 --y 260             # viewport coordinates
//   pnpm run elem-source -- --x 420 --y 260 --json      # machine-readable
//
// Flags: --port N (env IKI_CDP_PORT, default 9222) --target <substring>
// selects the window when several are open (see `pnpm run cdp -- list`).
//
// Without CDP (no --remote-debugging-port) the in-app probe still works inside
// the app: open DevTools with F12, click the element, and ask iki to use the
// `element_source` tool. This script is the command-line version of that.

const DEFAULT_PORT = process.env.IKI_CDP_PORT ?? '9222';

const args = process.argv.slice(2).filter(token => token !== '--');
const flags = {};
const positionals = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const next = args[i + 1];
    flags[args[i].slice(2)] = next && !next.startsWith('--') ? next : true;
    if (next && !next.startsWith('--')) i++;
  } else {
    positionals.push(args[i]);
  }
}

const port = flags.port ?? DEFAULT_PORT;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const fail = message => {
  console.error(`elem-source: ${message}`);
  process.exit(1);
};

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      }
    });
  }

  send(method, params = {}, timeoutMs = 20000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
      this.pending.set(id, {
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed');
    }
    return result.result.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

const connect = url =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(new CDP(ws)));
    ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)));
  });

const listTargets = async () => {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
  if (!response || !response.ok) {
    fail(`no CDP endpoint on 127.0.0.1:${port} — start the app with \`pnpm run app:debug\``);
  }
  const targets = await response.json();
  return targets.filter(target => target.type === 'page' && !target.url.startsWith('devtools://'));
};

const pickTarget = async () => {
  const targets = await listTargets();
  if (targets.length === 0) fail('no page targets to inspect');
  if (typeof flags.target === 'string') {
    const match = targets.find(target =>
      [target.id, target.title, target.url].some(value => String(value).includes(flags.target))
    );
    if (!match) fail(`no target matching "${flags.target}" — run \`pnpm run cdp -- list\``);
    return match;
  }
  return targets[0];
};

/**
 * The page-side walk. Kept in sync with the main process's `source_locator.ts`
 * probe: this script must also work against a window whose IPC bridge is not
 * reachable, and the two must agree on what a chain entry means.
 *
 * `__vueParentComponent` is Vue's *internal* instance — it has no `$options`.
 * The definition lives on `.type`, the public instance on `.proxy.$options`;
 * reading only `component.$options` finds nothing for any node, so the chain
 * came back empty (that was the original defect). In a Vite dev build `__file`
 * is an absolute path, sometimes with a `?vue&type=…` or HMR `?t=…` query
 * appended, which is stripped here because no such file exists on disk.
 */
const PROBE = target => `(() => {
  const win = window;
  const optionsOf = component => {
    if (!component) return null;
    if (component.$options) return component.$options;
    if (component.proxy && component.proxy.$options) return component.proxy.$options;
    return component.type || null;
  };
  const fileOf = component => {
    const options = optionsOf(component);
    const file = options && (options.__file || options.__name || options.name);
    if (typeof file !== 'string' || file.indexOf('.') === -1) return undefined;
    const queryAt = file.search(/[?#]/);
    return queryAt === -1 ? file : file.slice(0, queryAt);
  };
  const nameOf = component => {
    const options = optionsOf(component) || {};
    return options.name || options.__name || '';
  };
  const chainOf = instance => {
    const out = [];
    let current = instance;
    for (let depth = 0; current && depth < 12; depth++, current = current.parent || null) {
      const file = fileOf(current);
      const name = nameOf(current);
      if (file || name) out.push(file || name);
    }
    return out;
  };
  const element = ${
    target.kind === 'selector'
      ? `document.querySelector(${JSON.stringify(target.selector)})`
      : target.kind === 'point'
        ? `document.elementFromPoint(${JSON.stringify(target.point[0])}, ${JSON.stringify(target.point[1])})`
        : target.kind === 'hovered'
          ? 'win.__ikiDevToolsHovered && win.__ikiDevToolsHovered.isConnected ? win.__ikiDevToolsHovered : null'
          : 'win.__ikiDevToolsSelected && win.__ikiDevToolsSelected.isConnected ? win.__ikiDevToolsSelected : null'
  };
  if (!element) return { ok: false, reason: ${
    target.kind === 'selector'
      ? "'selector-not-found'"
      : target.kind === 'hovered'
        ? "'no-hovered-element'"
        : target.kind === 'point'
          ? "'nothing at that point'"
          : "'no-selected-element'"
  } };
  const rect = element.getBoundingClientRect();
  const chain = chainOf(element.__vueParentComponent || null);
  return {
    ok: true,
    selector: element.tagName.toLowerCase(),
    ownerFile: chain.find(value => value.indexOf('.') !== -1),
    chain,
    text: (element.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
    point: [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)],
  };
})()`;

/**
 * Arm the same recorders the main process installs, under the same window
 * keys, so a click or hover this script waits for is also readable by the
 * in-app `element_source` tool afterwards.
 */
const installRecorder = () => `(() => {
  const win = window;
  if (win.__ikiDevToolsRecorderInstalled) return 'already-installed';
  win.__ikiDevToolsRecorderInstalled = true;
  const record = key => event => {
    const target = event.target;
    win[key] = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
  };
  win.addEventListener('pointerdown', record('__ikiDevToolsSelected'), { capture: true, passive: true });
  win.addEventListener('click', record('__ikiDevToolsSelected'), { capture: true, passive: true });
  win.addEventListener('pointerover', record('__ikiDevToolsHovered'), { capture: true, passive: true });
  return 'installed';
})()`;

/**
 * The app's main process resolves the element (it owns the repo root and the
 * sourcemap hop); the answer is a plain object, so it comes back by value.
 */
const callBridge = async (cdp, method, request) => {
  try {
    const hasBridge = await cdp.eval(
      `Boolean(window.electronAPI && window.electronAPI.devtools && window.electronAPI.devtools.${method})`
    );
    if (!hasBridge) return null;
    return await cdp.eval(
      `window.electronAPI.devtools.${method}(${JSON.stringify(request ?? {})})`
    );
  } catch {
    return null;
  }
};

/** `packages/desktop/src/renderer/.../A.vue?vue&type=template` → the on-disk file. */
const cleanFile = value => (typeof value === 'string' ? value.replace(/[?#].*$/, '') : undefined);

const waitForClick = async () => {
  const target = await pickTarget();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.eval(installRecorder());
  console.error(
    `elem-source: waiting for a click in "${target.title}"${flags.timeout ? ` (${flags.timeout}ms)` : ''} …`
  );
  const deadline = Date.now() + Number(flags.timeout ?? 60000);
  try {
    while (Date.now() < deadline) {
      const clicked = await cdp.eval(
        'Boolean(window.__ikiDevToolsSelected && window.__ikiDevToolsSelected.isConnected)'
      );
      if (clicked) {
        const probe = await cdp.eval(PROBE({ kind: 'selected' }));
        if (probe.ok) return { cdp, target, probe };
      }
      await sleep(120);
    }
    fail('no click recorded before the timeout');
  } finally {
    // The caller still needs `cdp` for the position; it is closed there.
  }
};

const usage =
  'usage: pnpm run elem-source -- [--click | --hovered | --mode selected|hovered | --selector <css> | --x N --y N] [--json] [--port N] [--target substring]';

const main = async () => {
  if (flags.help || positionals[0] === 'help') {
    console.log(usage);
    return;
  }
  // `--mode` is the spelling the in-app tool uses; `--hovered` is the CLI shorthand.
  const mode = typeof flags.mode === 'string' ? flags.mode : undefined;
  if (mode && mode !== 'selected' && mode !== 'hovered') {
    fail(`--mode supports selected|hovered; for coordinates pass --x and --y\n  ${usage}`);
  }

  let cdp;
  let probe;
  let target;
  /** What we ask the app's own resolver for, in the same terms it uses. */
  let bridgeRequest;
  try {
    if (flags.click) {
      ({ cdp, probe, target } = await waitForClick());
      bridgeRequest = { target: 'selected' };
    } else if (flags.hovered === true || mode === 'hovered') {
      target = await pickTarget();
      cdp = await connect(target.webSocketDebuggerUrl);
      await cdp.send('Runtime.enable');
      await cdp.send('DOM.enable');
      await cdp.eval(installRecorder());
      probe = await cdp.eval(PROBE({ kind: 'hovered' }));
      bridgeRequest = { target: 'hovered' };
    } else if (mode === 'selected') {
      target = await pickTarget();
      cdp = await connect(target.webSocketDebuggerUrl);
      await cdp.send('Runtime.enable');
      await cdp.send('DOM.enable');
      await cdp.eval(installRecorder());
      probe = await cdp.eval(PROBE({ kind: 'selected' }));
      bridgeRequest = { target: 'selected' };
    } else {
      target = await pickTarget();
      cdp = await connect(target.webSocketDebuggerUrl);
      await cdp.send('Runtime.enable');
      await cdp.send('DOM.enable');
      if (typeof flags.selector === 'string') {
        probe = await cdp.eval(PROBE({ kind: 'selector', selector: flags.selector }));
        if (!probe?.ok) fail(`selector not found: ${flags.selector}`);
        bridgeRequest = { target: 'selector', selector: flags.selector };
      } else {
        if (flags.x === undefined || flags.y === undefined) {
          fail(`pass --click, --hovered, --selector <css>, or both --x and --y\n  ${usage}`);
        }
        const point = [Number(flags.x), Number(flags.y)];
        // Same probe, addressed by the element under the point.
        probe = await cdp.eval(PROBE({ kind: 'point', point }));
        bridgeRequest = { target: 'point', point };
      }
    }

    if (!probe?.ok) fail(probe?.reason ?? `could not read the element in "${target.title}"`);

    // Cross-check against the app's main process: that is the code path the
    // in-app `element_source` tool runs, and it owns the sourcemap hop.
    const probed = await callBridge(cdp, 'probeElement', bridgeRequest);
    const resolved = await callBridge(cdp, 'resolveElement', bridgeRequest);
    const locator = probed?.locator ?? resolved?.locator;

    const payload = {
      window: target.title,
      tag: probe.selector,
      components: probe.chain?.length ? probe.chain : (locator?.components ?? []),
      owner: cleanFile(locator?.ownerFile ?? probe.ownerFile),
      text: probe.text,
      ...(resolved?.mapped ? { file: resolved.mapped.source, line: resolved.mapped.line } : {}),
    };
    if (flags.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(
        `${payload.file ?? payload.owner ?? '(no Vue component)'}${payload.line ? `:${payload.line}` : ''}`
      );
      if (payload.components?.length) console.log(`components: ${payload.components.join(' < ')}`);
      if (payload.text) console.log(`text: ${payload.text}`);
      if (!payload.line) {
        console.log('(component file only — open it and search for the text above)');
        if (!resolved)
          console.log('(app bridge unavailable: is the app running from `pnpm run app:debug`?)');
      }
    }
  } finally {
    cdp?.close();
  }
};

main().catch(error => fail(error.message));
