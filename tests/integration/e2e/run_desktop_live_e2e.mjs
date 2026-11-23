// Real-API Desktop E2E test: launches the real Electron Desktop app (isolated
// --user-data-dir, driven over CDP) against a live LLM endpoint (default: local
// gateway on port 3425 using `workbuddy/hy4flash-free`).
// Self-skips cleanly if the endpoint is unreachable.
//
// Proves end-to-end on the real Desktop UI:
//   1. Main + preload (.cjs) + Vue renderer boot cleanly with live provider config
//   2. Turn 1: live model streams a reply into the DOM and persists JSONL usage
//   3. Turn 2: live model executes the shell tool (bash/pwsh) in the bound workspace
//      and writes a real file on disk
//   4. Turn 3: live model recalls what it wrote from replayed multi-turn history
//
// Env overrides:
//   IKI_LIVE_BASE_URL   (default: http://127.0.0.1:3425/v1)
//   IKI_LIVE_MODEL      (default: workbuddy/hy4flash-free)
//   IKI_LIVE_PROVIDER   (default: openai-compatible)
//   IKI_LIVE_API_KEY    (default: local-gateway)
//   CDP_PORT            (default: 18743)
//   IKI_VITE_PORT       (default: 5179)
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyToml } from 'smol-toml';

import { connect, findRendererTarget } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BASE_URL = process.env.IKI_LIVE_BASE_URL || 'http://127.0.0.1:3425/v1';
const MODEL = process.env.IKI_LIVE_MODEL || 'workbuddy/hy4flash-free';
const PROVIDER_TYPE = process.env.IKI_LIVE_PROVIDER || 'openai-compatible';
const API_KEY = process.env.IKI_LIVE_API_KEY || 'local-gateway';
const CDP_PORT = Number(process.env.CDP_PORT || 18743);
process.env.CDP_PORT = String(CDP_PORT);
const VITE_PORT = Number(process.env.IKI_VITE_PORT || 5179);
const SHELL_TOOL = process.platform === 'win32' ? 'pwsh' : 'bash';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (...args) => console.log('[desktop-live-e2e]', ...args);

const isGatewayReachable = async () => {
  try {
    const res = await fetch(`${BASE_URL.replace(/\/+$/, '')}/models`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
};

if (!(await isGatewayReachable())) {
  log(`SKIP — live endpoint unreachable at ${BASE_URL}`);
  process.exit(0);
}

let workDir;
const launchedPids = [];
let currentStep = 'startup';
const step = name => {
  currentStep = name;
  log('step:', name);
};

const cleanup = () => {
  for (const pid of launchedPids.splice(0)) {
    try { process.kill(-pid, 'SIGKILL'); } catch {}
  }
  if (workDir) {
    for (const pattern of [`user-data-dir=${workDir}/userdata`, `user-data-dir=/private${workDir}/userdata`]) {
      try {
        const out = execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' });
        for (const pid of out.split('\n').filter(Boolean)) {
          try { process.kill(Number(pid), 'SIGKILL'); } catch {}
        }
      } catch {}
    }
    if (!process.exitCode) {
      fs.rmSync(workDir, { recursive: true, force: true });
    } else {
      console.error('[desktop-live-e2e] kept failure scene:', workDir);
    }
  }
};
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log(`interrupted at step: ${currentStep}`);
    cleanup();
    process.exit(130);
  });
}
const watchdog = setTimeout(() => {
  console.error('[desktop-live-e2e] FAIL: watchdog timeout at step:', currentStep);
  cleanup();
  process.exit(1);
}, 6 * 60 * 1000);
watchdog.unref?.();

const portBusy = port => {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    return Boolean(out.trim());
  } catch {
    return false;
  }
};

const waitForEval = async (cdp, expression, label, timeoutMs = 90000) => {
  const start = Date.now();
  for (;;) {
    const value = await cdp.eval(expression).catch(() => null);
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(500);
  }
};

const waitForFile = async (probe, label, timeoutMs = 90000) => {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(400);
  }
};

const waitForCdp = async (label, child) => {
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`app (${label}) exited before exposing CDP`);
    }
    try {
      const target = await findRendererTarget();
      if (target) {
        const cdp = await connect(target.webSocketDebuggerUrl);
        const ready = await cdp.eval('document.readyState').catch(() => null);
        if (ready) return cdp;
        cdp.close();
      }
    } catch {}
    await sleep(1500);
  }
  throw new Error(`app (${label}) never exposed a renderer via CDP`);
};

const launchApp = async label => {
  const child = spawn(
    'npx',
    ['electron-forge', 'start', '--', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${workDir}/userdata`],
    {
      cwd: path.join(ROOT, 'packages/desktop'),
      env: {
        ...process.env,
        IKI_VITE_PORT: String(VITE_PORT),
        IKI_LOG_DIR: path.join(workDir, 'logs'),
        MAIN_WINDOW_VITE_DEV_SERVER_URL: `http://127.0.0.1:${VITE_PORT}`,
        IKI_AUTO_OPEN_DEVTOOLS: 'false',
        IKI_WINDOW_WIDTH: '1200',
        IKI_WINDOW_HEIGHT: '800',
      },
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: true,
    }
  );
  launchedPids.push(child.pid);
  child.unref();
  return await waitForCdp(label, child);
};

const pickLiveModel = async cdp => {
  const already = await cdp
    .eval(`document.querySelector('.model-selector-trigger')?.textContent?.includes(${JSON.stringify(MODEL)}) ? 1 : 0`)
    .catch(() => 0);
  if (already) return;

  await waitForEval(cdp, `document.querySelector('.model-selector-trigger') ? 1 : 0`, 'model selector trigger', 30000);
  await cdp.eval(`document.querySelector('.model-selector-trigger').click(); 1`);
  await waitForEval(cdp, `document.querySelector('.model-menu-cell') ? 1 : 0`, 'model menu root', 10000);
  await cdp.eval(`document.querySelector('.model-menu-cell').click(); 1`);
  await waitForEval(
    cdp,
    `(function(){
      const btn = [...document.querySelectorAll('.model-option')].find(b =>
        (b.querySelector('.model-option-name')?.textContent || b.textContent || '').trim() === ${JSON.stringify(MODEL)}
      );
      if (!btn) return 0;
      btn.click();
      return 1;
    })()`,
    `model option ${MODEL}`,
    20000
  );
  await waitForEval(
    cdp,
    `document.querySelector('.model-selector-trigger')?.textContent?.includes(${JSON.stringify(MODEL)}) ? 1 : 0`,
    `model selector showing ${MODEL}`,
    15000
  );
};

const typeAndSend = async (cdp, text) => {
  const typed = await cdp.eval(`(function(){
    const ta = document.querySelector('textarea');
    if (!ta) return 'NO_TEXTAREA';
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set;
    ta.focus(); setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', {bubbles: true}));
    return 'OK';
  })()`);
  if (typed !== 'OK') throw new Error('composer textarea not found: ' + typed);
  await sleep(300);
  const sent = await cdp.eval(`(function(){
    const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')||'').toLowerCase().includes('send'));
    if (!btn || btn.disabled) return btn ? 'DISABLED' : 'NO_BUTTON';
    btn.click(); return 'OK';
  })()`);
  if (sent !== 'OK') throw new Error('send failed: ' + sent);
};

const readAllSessionEvents = () => {
  const dir = path.join(workDir, 'userdata', 'sessions');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(name => name.endsWith('.jsonl'))
    .flatMap(name =>
      fs
        .readFileSync(path.join(dir, name), 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap(line => {
          try {
            const parsed = JSON.parse(line);
            return parsed.kind === 'batch' && Array.isArray(parsed.events) ? parsed.events : [];
          } catch {
            return [];
          }
        })
    );
};

const main = async () => {
  for (const port of [CDP_PORT, VITE_PORT]) {
    if (portBusy(port)) {
      throw new Error(`port ${port} is busy; free it or set CDP_PORT / IKI_VITE_PORT`);
    }
  }

  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-desktop-live-e2e-'));
  const userDataDir = path.join(workDir, 'userdata');
  const workspaceDir = path.join(workDir, 'ws');
  fs.mkdirSync(path.join(userDataDir, 'state'), { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });

  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(userDataDir, 'models.toml'),
    stringifyToml({
      providers: {
        live_gateway: {
          name: 'Live Gateway',
          type: PROVIDER_TYPE,
          apiKey: API_KEY,
          baseUrl: BASE_URL,
          models: [MODEL],
          availableModels: [MODEL],
          modelOptions: {},
          enabled: true,
        },
      },
    })
  );
  fs.writeFileSync(
    path.join(userDataDir, 'state', 'workspaces.json'),
    JSON.stringify([
      {
        id: 'ws-live',
        path: workspaceDir,
        name: 'Desktop Live WS',
        is_temporary: false,
        show_in_list: true,
        created_at: now,
        updated_at: now,
      },
    ])
  );

  step('boot Desktop app with live provider');
  const cdp = await launchApp('desktop-live');
  await waitForEval(cdp, `window.electronAPI ? 1 : 0`, 'preload window.electronAPI', 20000);
  await pickLiveModel(cdp);

  step('select isolated workspace in header workspace picker');
  await waitForEval(
    cdp,
    `(function(){
      const sel = document.querySelector('.workspace-selector-select');
      if (!sel) return 0;
      const opt = [...sel.options].find(o => o.value === 'ws-live');
      if (!opt) return 0;
      sel.value = 'ws-live';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return sel.value === 'ws-live' ? 1 : 0;
    })()`,
    'workspace selector bound to ws-live',
    20000
  );

  step('turn 1: real streaming text reply');
  await typeAndSend(cdp, 'Reply with the exact token DESKTOP_LIVE_OK_1 and nothing else.');
  await waitForEval(
    cdp,
    `document.body.textContent.includes('DESKTOP_LIVE_OK_1') ? 1 : 0`,
    'turn 1 live reply rendered',
    90000
  );
  await waitForFile(
    () => readAllSessionEvents().filter(e => e.type === 'turn_completed').length >= 1,
    'turn 1 turn_completed in session JSONL',
    30000
  );

  step(`turn 2: real ${SHELL_TOOL} tool execution in bound workspace`);
  await typeAndSend(
    cdp,
    `Use the ${SHELL_TOOL} tool to create a file named "desktop-live-check.txt" in the current working directory containing the exact text "hello-desktop-live" (no extra words).`
  );
  const checkFile = path.join(workspaceDir, 'desktop-live-check.txt');
  const written = await waitForFile(
    () => (fs.existsSync(checkFile) ? fs.readFileSync(checkFile, 'utf8') : null),
    'desktop-live-check.txt written by live model',
    90000
  );
  assert.ok(
    written.includes('hello-desktop-live'),
    `expected desktop-live-check.txt to contain hello-desktop-live, got: ${written}`
  );
  await waitForFile(
    () => readAllSessionEvents().filter(e => e.type === 'turn_completed').length >= 2,
    'turn 2 turn_completed in session JSONL',
    60000
  );

  step('turn 3: multi-turn history recall through Desktop UI');
  await typeAndSend(cdp, 'What exact text did you just write to desktop-live-check.txt? Reply with that text.');
  await waitForFile(
    () => readAllSessionEvents().filter(e => e.type === 'turn_completed').length >= 3,
    'turn 3 turn_completed in session JSONL',
    90000
  );
  const events = readAllSessionEvents();
  const committedOutputs = events.filter(e => e.type === 'model_output_committed');
  const lastOutput = committedOutputs.at(-1);
  const lastText = (lastOutput?.payload?.message?.parts ?? [])
    .filter(p => p.type === 'text')
    .map(p => p.text)
    .join('');
  assert.ok(
    lastText.includes('hello-desktop-live'),
    `expected turn 3 to recall hello-desktop-live, got: ${lastText}`
  );

  const usagePart = (lastOutput?.payload?.message?.parts ?? []).find(p => p.type === 'data-token-usage');
  const inputTokens = usagePart?.data?.inputTokens ?? 0;
  const cacheReadTokens = usagePart?.data?.cacheReadTokens ?? 0;
  assert.ok(inputTokens > 0, 'turn 3 should report real inputTokens > 0');

  cdp.close();
  log(
    `PASS (${MODEL}) — real Desktop UI boot, streaming, ${SHELL_TOOL} tool write, JSONL persistence, and multi-turn recall verified ` +
      `(turn3 in=${inputTokens} cacheRead=${cacheReadTokens})`
  );
};

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch(error => {
    console.error(`[desktop-live-e2e] FAIL at step [${currentStep}]:`, error?.message || error);
    process.exitCode = 1;
    cleanup();
    process.exit(1);
  });
