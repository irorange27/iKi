#!/usr/bin/env node
// Drive a running iki desktop app over the Chrome DevTools Protocol — the
// scripted path for UI verification (screenshots, hover, clicks, theme
// switches) against the real renderer, preload and data. Zero dependencies:
// Node's built-in fetch + WebSocket only.
//
// Usage:
//   pnpm run app:debug                      # app with CDP on 127.0.0.1:9222
//   pnpm run cdp -- list
//   pnpm run cdp -- eval "<js expression>"  # awaited; wrap side effects in (() => { ... })()
//   pnpm run cdp -- shot out.png [--clip x,y,w,h] [--scale 2]
//   pnpm run cdp -- hover "<css selector>" [--wait ms]
//   pnpm run cdp -- click "<css selector>"
//   pnpm run cdp -- theme <light|dark|system>   # via the settings window, then closes it
//
// Global flags: --port N (env IKI_CDP_PORT, default 9222), --target <substring>
// (matches a page target by id/title/url; default: the first page target —
// use `list` to discover, settings windows appear as extra "iKi" pages).

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

const [command, ...rest] = positionals;
const port = flags.port ?? DEFAULT_PORT;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const fail = message => {
  console.error(`app_cdp: ${message}`);
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
      const detail = result.exceptionDetails;
      throw new Error(detail.exception?.description ?? detail.text ?? 'page eval failed');
    }
    return result.result?.value;
  }

  async shot(file, clip, scale) {
    const params = { format: 'png' };
    if (clip) params.clip = { ...clip, scale };
    const result = await this.send('Page.captureScreenshot', params);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, Buffer.from(result.data, 'base64'));
    return result.data.length;
  }

  async inputEvent(type, x, y, extra = {}) {
    await this.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      clickCount: type === 'mousePressed' || type === 'mouseReleased' ? 1 : undefined,
      ...extra,
    });
  }

  close() {
    this.ws.close();
  }
}

const connect = url =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error(`connect timed out: ${url}`)), 5000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(new CDP(ws));
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`websocket failed: ${url}`));
    });
  });

const listTargets = async () => {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/json`);
  } catch {
    fail(`no CDP endpoint on 127.0.0.1:${port} — start the app with \`pnpm run app:debug\``);
  }
  return (await response.json()).filter(
    target => target.type === 'page' && !target.url.startsWith('devtools:')
  );
};

const pickTarget = async () => {
  const targets = await listTargets();
  if (targets.length === 0) fail('no page targets — is the app window open?');
  const needle = flags.target;
  const target = needle
    ? targets.find(
        t => t.id.includes(needle) || t.title.includes(needle) || t.url.includes(needle)
      )
    : targets[0];
  if (!target) fail(`no target matching "${needle}" — run \`list\` to see targets`);
  return target;
};

const attach = async () => {
  const target = await pickTarget();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return { cdp, target };
};

// The settings window is just another page target. Open it (or focus it) via
// the app's own IPC, then prefer whichever target is new; if openSettings only
// focused an existing window, fall back to the extra page beside the main one.
const attachSettings = async mainTargetId => {
  const before = new Set((await listTargets()).map(t => t.id));
  const opener = await connect((await pickTarget()).webSocketDebuggerUrl);
  await opener.send('Runtime.enable');
  await opener.eval('window.electronAPI.openSettings()');
  opener.close();
  let settings = null;
  for (let i = 0; i < 25 && !settings; i++) {
    await sleep(200);
    const now = await listTargets();
    settings = now.find(t => !before.has(t.id)) ?? now.find(t => t.id !== mainTargetId) ?? null;
  }
  if (!settings) fail('settings window did not appear');
  const cdp = await connect(settings.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  return cdp;
};

const THEME_PILL_TEXT = {
  light: ['浅色', 'Light'],
  dark: ['深色', 'Dark'],
  system: ['跟随系统', 'System'],
};

const clickThemePill = (cdp, variant) =>
  cdp.eval(`(() => {
    const wanted = ${JSON.stringify(THEME_PILL_TEXT[variant])};
    const pill = [...document.querySelectorAll('button.mode-pill')].find(button =>
      wanted.includes(button.textContent.trim())
    );
    if (!pill) return 'pill-not-found';
    pill.click();
    return 'ok';
  })()`);

const rectOf = (cdp, selector) =>
  cdp.eval(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  })()`);

const main = async () => {
  if (!command || command === 'help' || flags.help) {
    console.log(
      'usage: pnpm run cdp -- <list|eval|shot|hover|click|theme> [args] [--port N] [--target substring]'
    );
    return;
  }

  if (command === 'list') {
    for (const target of await listTargets()) {
      console.log(`${target.id}  ${target.title}  ${target.url}`);
    }
    return;
  }

  if (command === 'eval') {
    if (rest.length === 0) fail('eval needs an expression');
    const { cdp } = await attach();
    const value = await cdp.eval(rest.join(' '));
    console.log(typeof value === 'string' ? value : JSON.stringify(value));
    cdp.close();
    return;
  }

  if (command === 'shot') {
    const file = rest[0] ?? 'iki_cdp_shot.png';
    const { cdp, target } = await attach();
    const clip = flags.clip
      ? (() => {
          const [x, y, width, height] = String(flags.clip).split(',').map(Number);
          return { x, y, width, height };
        })()
      : undefined;
    const bytes = await cdp.shot(file, clip, Number(flags.scale ?? 1));
    console.log(`${file} (${Math.round(bytes / 1024)} KiB, target: ${target.title})`);
    cdp.close();
    return;
  }

  if (command === 'hover' || command === 'click') {
    if (rest.length === 0) fail(`${command} needs a css selector`);
    const { cdp } = await attach();
    const point = JSON.parse(await rectOf(cdp, rest[0]));
    if (!point) fail(`selector not found: ${rest[0]}`);
    if (command === 'click') {
      await cdp.eval(
        `document.querySelector(${JSON.stringify(rest[0])}).scrollIntoView({ block: 'nearest' })`
      );
      await sleep(120);
    }
    await cdp.inputEvent('mouseMoved', point.x, point.y);
    if (command === 'click') {
      await sleep(40);
      await cdp.inputEvent('mousePressed', point.x, point.y);
      await cdp.inputEvent('mouseReleased', point.x, point.y);
    }
    await sleep(Number(flags.wait ?? (command === 'hover' ? 400 : 150)));
    cdp.close();
    console.log(`${command} ${rest[0]} @ ${Math.round(point.x)},${Math.round(point.y)}`);
    return;
  }

  if (command === 'theme') {
    const variant = rest[0];
    if (!variant || !THEME_PILL_TEXT[variant]) {
      fail('theme needs light | dark | system');
    }
    const mainTarget = await pickTarget();
    const expected = variant === 'system' ? ['dark', 'light'] : [variant];
    const { cdp: main } = await attach();
    let settings = await attachSettings(mainTarget.id);
    let applied = null;
    // The pill click only counts once the settings renderer has mounted, and a
    // just-recycled settings window can swallow the first click — confirm the
    // attribute actually flipped on the main window before trusting it.
    for (let attempt = 0; attempt < 3 && !expected.includes(applied); attempt++) {
      let outcome;
      try {
        outcome = await clickThemePill(settings, variant);
      } catch {
        settings = await attachSettings(mainTarget.id);
        outcome = await clickThemePill(settings, variant);
      }
      if (outcome !== 'ok') {
        await sleep(500);
        continue;
      }
      await sleep(700);
      applied = await main.eval(`document.documentElement.getAttribute('data-theme')`);
    }
    try {
      await settings.eval(`(() => {
        const button = [...document.querySelectorAll('button')]
          .find(candidate => candidate.textContent.trim() === '关闭' || candidate.textContent.trim() === 'Close');
        if (button) button.click();
      })()`);
    } catch {
      // settings connection already gone — window closed itself
    }
    main.close();
    settings.close();
    if (!expected.includes(applied)) {
      fail(`theme ${variant} did not apply (data-theme=${applied})`);
    }
    console.log(`theme ${variant}: data-theme=${applied}`);
    return;
  }

  fail(`unknown command "${command}" — try list | eval | shot | hover | click | theme`);
};

main().catch(error => fail(error.message));
