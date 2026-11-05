// e2e gate #2 — the settings surface as a product path, not a fixture.
//
// What this proves that the seeded smoke gate does NOT:
//   1. A human can configure an LLM provider in the Settings window (real Vue
//      form over CDP): API key, base URL, fetch models from the endpoint,
//      toggle a model on, enable the provider, press Save.
//   2. The saved declaration actually works: models.toml holds the structured
//      declaration (asserted by reading the file), the chat composer picks the
//      provider WITHOUT a reload — the MAIN model selector lists, accepts, and
//      shows it (providers:updated broadcast) — and a real turn streams.
//   3. Multi-turn history is carried: turn two sends CHECK_HISTORY, which the
//      faux endpoint only answers with a HISTORY_REPORT when the request
//      contains the earlier turns — the boss's "每轮 = 过去请求总和 + 新输入"
//      asserted at the wire, not mocked.
//
// Usage: pnpm run test:e2e:settings   (free ports 18742 / 5178 / 18733)
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseToml } from 'smol-toml';

import { connect, findRendererTarget } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CDP_PORT = Number(process.env.CDP_PORT || 18742);
process.env.CDP_PORT = String(CDP_PORT);
const VITE_PORT = Number(process.env.IKI_VITE_PORT || 5178);
const FAUX_PORT = Number(process.env.IKI_E2E_FAUX_PORT || 18733);
const FAUX_BASE_URL = `http://127.0.0.1:${FAUX_PORT}/v1`;
const MODEL = 'faux-e2e-model';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (...args) => console.log('[settings-e2e]', ...args);

let workDir;
let faux;
const launchedPids = [];
let currentStep = 'startup';
const step = name => {
  currentStep = name;
  log('step:', name);
};

const storeDir = () => path.join(workDir, 'userdata/iki-store');
const modelsTomlPath = () => path.join(storeDir(), 'models.toml');
const readModelsToml = () => {
  try {
    const parsed = parseToml(fs.readFileSync(modelsTomlPath(), 'utf8'));
    return parsed?.providers ?? null;
  } catch {
    return null;
  }
};
const sessionEventCount = () => {
  const dir = path.join(storeDir(), 'sessions');
  let names = [];
  try {
    names = fs.readdirSync(dir).filter(name => name.endsWith('.jsonl'));
  } catch {
    return 0;
  }
  return names.reduce((total, name) => {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    return (
      total +
      text
        .split('\n')
        .filter(Boolean)
        .reduce((sum, line) => {
          try {
            const parsed = JSON.parse(line);
            return parsed.kind === 'batch' ? sum + parsed.events.length : sum;
          } catch {
            return sum;
          }
        }, 0)
    );
  }, 0);
};

const cleanup = () => {
  // Kill the faux server by PID only. In this harness `detached` does not
  // actually create a new process group (children share the wrapper's pgid),
  // so a `kill(-pid)` here would signal — and silently kill — the runner
  // itself before the exit code could be reported.
  if (faux) {
    try { faux.kill('SIGKILL'); } catch {}
    faux = null;
  }
  for (const pid of launchedPids.splice(0)) {
    try { process.kill(-pid, 'SIGKILL'); } catch {}
  }
  for (const pattern of [`user-data-dir=${workDir}/userdata`, `user-data-dir=/private${workDir}/userdata`]) {
    try {
      const out = execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' });
      for (const pid of out.split('\n').filter(Boolean)) {
        try { process.kill(Number(pid), 'SIGKILL'); } catch {}
      }
    } catch {}
  }
  if (workDir && !process.exitCode) {
    fs.rmSync(workDir, { recursive: true, force: true });
  } else if (workDir) {
    console.error('[settings-e2e] kept failure scene:', workDir);
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
  console.error('[settings-e2e] FAIL: watchdog timeout at step:', currentStep);
  cleanup();
  process.exit(1);
}, 8 * 60 * 1000);
watchdog.unref?.();

const portBusy = port => {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    return Boolean(out.trim());
  } catch {
    return false;
  }
};

const preflightPortsFree = () => {
  for (const port of [CDP_PORT, VITE_PORT, FAUX_PORT]) {
    if (portBusy(port)) throw new Error(`port ${port} is busy; free it or set CDP_PORT / IKI_VITE_PORT`);
  }
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
        MAIN_WINDOW_VITE_DEV_SERVER_URL: `http://127.0.0.1:${VITE_PORT}`,
        IKI_AUTO_OPEN_DEVTOOLS: 'false',
      },
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: true,
    }
  );
  launchedPids.push(child.pid);
  child.unref();
  return await waitForCdp(label, child);
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
    await sleep(2000);
  }
  throw new Error(`app (${label}) never exposed a renderer via CDP`);
};

const listPages = async () => {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  return targets.filter(t => t.type === 'page' && !/devtools/i.test(t.url));
};

const findSettingsTarget = async () => {
  const pages = await listPages();
  return pages.find(t => /#settings/.test(t.url)) || null;
};

const waitForSettingsWindow = async () => {
  for (let i = 0; i < 40; i++) {
    const target = await findSettingsTarget();
    if (target) {
      const cdp = await connect(target.webSocketDebuggerUrl);
      if (await cdp.eval('document.readyState').catch(() => null)) return { cdp, targetId: target.id };
      cdp.close();
    }
    await sleep(500);
  }
  throw new Error('settings window never appeared over CDP');
};

// Click the first element matching `selector` whose text contains `text`.
const clickWhere = async (cdp, selector, text) =>
  cdp.eval(`(function(){
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const target = nodes.find(n => (n.textContent || '').includes(${JSON.stringify(text)}));
    if (!target) return 'NO_MATCH:' + nodes.length;
    target.click(); return 'OK';
  })()`);

const setNativeValue = async (cdp, selector, value) =>
  cdp.eval(`(function(){
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return 'NO_INPUT';
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
    input.focus(); setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', {bubbles: true}));
    return 'OK';
  })()`);

// The base URL field is the second plain text input in the provider form
// (first is the API key inside .provider-secret-input).
const setBaseUrl = async (cdp, value) =>
  cdp.eval(`(function(){
    const fields = [...document.querySelectorAll('.provider-field')];
    const input = fields.map(f => f.querySelector('input[type=text]')).filter(Boolean).pop();
    if (!input) return 'NO_BASEURL_INPUT';
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
    input.focus(); setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', {bubbles: true}));
    return 'OK';
  })()`);

const waitForEval = async (cdp, expression, label, timeoutMs = 60000) => {
  const start = Date.now();
  for (;;) {
    const value = await cdp.eval(expression).catch(() => null);
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(500);
  }
};

const waitForFile = async (probe, label, timeoutMs = 30000) => {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(400);
  }
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

// The saved provider must show up in the MAIN window's model selector — that
// is the user-visible contract of "configured in settings, usable on the home
// page": the dropdown lists the Ollama group with the model option, clicking
// it registers the selection, and the trigger reflects it. All without a
// page reload (driven by the providers:updated broadcast).
const assertProviderVisibleInModelSelector = async cdp => {
  const opened = await cdp.eval(`(function(){
    const trigger = document.querySelector('.model-selector-trigger');
    if (!trigger) return 'NO_TRIGGER';
    trigger.click();
    return 'OK';
  })()`);
  if (opened !== 'OK') throw new Error('model selector trigger missing: ' + opened);

  // The dropdown opens on the root menu (DSH-style drill-in cells); the
  // grouped provider/model list lives one pane deeper — click into "Model".
  const drilled = await waitForEval(
    cdp,
    `(function(){
      const cell = [...document.querySelectorAll('.model-menu-cell')].find(b => b.querySelector('.model-menu-cell-label'));
      if (!cell) return 0;
      cell.click();
      return 1;
    })()`,
    'model pane offered from the selector root menu',
    10000
  ).catch(() => 0);
  if (!drilled) throw new Error('selector root menu never rendered the Model cell');

  const listed = await waitForEval(
    cdp,
    `[...document.querySelectorAll('.model-option')].some(b => (b.querySelector('.model-option-name')?.textContent || b.textContent).trim() === ${JSON.stringify(MODEL)}) ? 1 : 0`,
    `saved model ${MODEL} listed in the model selector dropdown`,
    30000
  ).catch(() => null);
  if (!listed) throw new Error(MODEL + ' was not offered in the model selector after the settings save');

  const grouped = await cdp.eval(
    `[...document.querySelectorAll('.model-provider-group')].some(g => (g.querySelector('.model-provider-name')?.textContent || '').includes('Ollama') && [...g.querySelectorAll('.model-option')].some(b => (b.textContent || '').includes(${JSON.stringify(MODEL)}))) ? 1 : 0`
  ).catch(() => 0);
  if (!grouped) throw new Error('the Ollama group carrying the saved model was not rendered in the selector');

  const picked = await cdp.eval(`(function(){
    const btn = [...document.querySelectorAll('.model-option')].find(b => (b.querySelector('.model-option-name')?.textContent || b.textContent).trim() === ${JSON.stringify(MODEL)});
    if (!btn) return 'NO_OPTION';
    btn.click();
    return 'OK';
  })()`);
  if (picked !== 'OK') throw new Error('model option click failed: ' + picked);

  await waitForEval(
    cdp,
    `document.querySelector('.model-selector-trigger')?.textContent?.includes(${JSON.stringify(MODEL)}) ? 1 : 0`,
    'model selector trigger shows the saved model after picking it',
    15000
  );
};

const main = async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-settings-e2e-'));
  fs.mkdirSync(path.join(workDir, 'ws'), { recursive: true });

  step('start faux provider');
  await preflightPortsFree();
  faux = spawn(process.execPath, ['faux_openai_server.mjs'], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    env: { ...process.env, FAUX_PORT: String(FAUX_PORT), FAUX_LOG: path.join(workDir, 'faux.log') },
    stdio: ['ignore', fs.openSync(path.join(workDir, 'faux-stdout.log'), 'a'), fs.openSync(path.join(workDir, 'faux-stderr.log'), 'a')],
  });
  // unref: node must not wait on the child handle, or the runner would hang
  // forever after PASS whenever the server outlives cleanup.
  faux.unref();
  let providerUp = false;
  for (let i = 0; i < 10; i++) {
    try {
      execFileSync('curl', ['-s', '--max-time', '1', `http://127.0.0.1:${FAUX_PORT}/v1/models`, '-o', '/dev/null']);
      providerUp = true;
      break;
    } catch {}
    await sleep(500);
  }
  if (!providerUp) throw new Error('faux provider did not come up');

  step('boot app WITHOUT any provider configuration');
  const mainCdp = await launchApp('boot1');
  // The store exists, nothing seeded: provider list must be empty.
  if (readModelsToml() && Object.keys(readModelsToml()).length > 0) {
    throw new Error('expected an empty models.toml at boot, isolation failed');
  }
  await sleep(4000);

  step('open Settings window on the models/providers section');
  const opened = await mainCdp.eval(`(function(){
    if (!window.electronAPI?.openSettings) return 'NO_API';
    window.electronAPI.openSettings('models');
    return 'OK';
  })()`);
  if (opened !== 'OK') throw new Error('openSettings failed: ' + opened);
  const { cdp: settingsCdp } = await waitForSettingsWindow();

  step('pick the built-in Ollama provider in the sidebar');
  await waitForEval(settingsCdp, `document.querySelector('.provider-list-item') ? 1 : 0`, 'provider sidebar rows');
    // Ollama is the built-in provider that speaks the chat/completions dialect the
  // faux endpoint serves (built-in OpenAI routes to openai-responses).
  const clicked = await clickWhere(settingsCdp, '.provider-list-item', 'Ollama');
  if (clicked !== 'OK') throw new Error('Ollama row click failed: ' + clicked);
  await waitForEval(settingsCdp, `document.querySelector('.provider-secret-input input') ? 1 : 0`, 'provider detail form');

  step('fill API key + base URL, fetch models, enable provider');
  if (await setNativeValue(settingsCdp, '.provider-secret-input input', 'sk-e2e') !== 'OK') throw new Error('api key input not fillable');
  if (await setBaseUrl(settingsCdp, FAUX_BASE_URL) !== 'OK') throw new Error('base url input not fillable');

  // The models panel auto-fetches when opened with an empty list; click the
  // toggle, then explicitly fetch to hit the faux endpoint's GET /v1/models.
  await clickWhere(settingsCdp, '.provider-models-toggle', '').catch(() => {});
  await sleep(500);
  await clickWhere(settingsCdp, '.fetch-models-btn', '').catch(() => {});
  const fetchErr = await waitForEval(
    settingsCdp,
    `[...document.querySelectorAll('.provider-model-row')].some(r => (r.textContent||'').includes(${JSON.stringify(MODEL)})) ? 1 : 0`,
    `fetched model row for ${MODEL}`,
    30000
  ).catch(() => null);
  if (!fetchErr) throw new Error('fetch-models never surfaced ' + MODEL + ' from the live endpoint');

  // Toggle the model on: click the checkbox inside its row.
  const toggled = await settingsCdp.eval(`(function(){
    const row = [...document.querySelectorAll('.provider-model-row')].find(r => (r.textContent||'').includes(${JSON.stringify(MODEL)}));
    if (!row) return 'NO_ROW';
    const box = row.querySelector('input[type=checkbox]');
    if (!box) return 'NO_CHECKBOX';
    if (!box.checked) box.click();
    return row.querySelector('.provider-model-row-enabled') || box.checked ? 'ON' : 'STILL_OFF';
  })()`);
  if (toggled !== 'ON') throw new Error('model toggle did not enable: ' + toggled);

  // Enable the provider (required for canSave), then press Save.
  const enabled = await settingsCdp.eval(`(function(){
    const sw = document.querySelector('.provider-switch input');
    if (!sw) return 'NO_SWITCH';
    if (!sw.checked) sw.click();
    return sw.checked || document.querySelector('.provider-switch input').checked ? 'ON' : 'OFF';
  })()`);
  if (enabled !== 'ON') throw new Error('provider enable switch did not turn on: ' + enabled);

  await waitForEval(settingsCdp, `document.querySelector('.provider-card-actions .primary-btn:not([disabled])') ? 1 : 0`, 'save button enabled');
  const saved = await clickWhere(settingsCdp, '.provider-card-actions .primary-btn', '');
  if (saved !== 'OK') throw new Error('save click failed: ' + saved);

  step('assert the SAVED declaration in models.toml (structured, not stringified)');
  const providers = await waitForFile(() => {
    const map = readModelsToml();
    if (!map) return null;
    const entry = Object.entries(map).find(
      ([, p]) => p.type === 'ollama' && p.enabled === true
    );
    return entry ? entry : null;
  }, 'enabled openai provider written to models.toml');
  const [providerId, provider] = providers;
  const modelsField = Array.isArray(provider.models) ? provider.models : [];
  if (!modelsField.includes(MODEL)) throw new Error(`models.toml provider ${providerId} has models=${JSON.stringify(provider.models)}`);
  if (provider.baseUrl !== FAUX_BASE_URL) throw new Error(`baseUrl mismatch: ${provider.baseUrl}`);
  if (provider.apiKey !== 'sk-e2e') throw new Error('apiKey mismatch');
  log('saved provider declaration OK:', providerId, JSON.stringify({ type: provider.type, models: modelsField, baseUrl: provider.baseUrl }));

  step('close the settings window; the main model selector must offer the saved provider live');
  try {
    await settingsCdp.send('Target.closeTarget', { targetId: (await findSettingsTarget())?.id });
  } catch (error) {
    log('closeTarget failed (non-fatal):', error.message);
  }
  settingsCdp.close();
  await assertProviderVisibleInModelSelector(mainCdp);

  step('turn 1 through the UI-configured provider');
  await typeAndSend(mainCdp, 'PING_SETTINGS_E2E');
  await waitForEval(mainCdp, `document.body.textContent.includes('ack.')`, 'turn 1 reply rendered', 90000);

  step('turn 2: CHECK_HISTORY proves the request carried turn 1 at the wire');
  await typeAndSend(mainCdp, 'CHECK_HISTORY settings-flow-carried-earlier-turn');
  await waitForEval(
    mainCdp,
    `/HISTORY_REPORT\\[CHECK_HISTORY settings/.test(document.body.textContent)`,
    'history report from the second turn',
    90000
  );

  step('assert the session log recorded both turns');
  const events = await waitForFile(() => (sessionEventCount() >= 2 ? sessionEventCount() : null), 'session events for two turns', 10000);
  log('session event batches:', events);

  mainCdp.close();
  clearTimeout(watchdog);
  log('PASS — provider configured via the Settings UI, saved to models.toml, used live, history carried across turns');
};

try {
  await main();
} catch (error) {
  console.error('[settings-e2e] FAIL at step [' + currentStep + ']:', error.message);
  process.exitCode = 1;
} finally {
  // Same contract as run_smoke: the app runs detached; without killing its
  // process group here, node waits on the child forever and the runner hangs
  // after PASS.
  cleanup();
}
