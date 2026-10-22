// Standing e2e smoke gate: drives the real Electron app (isolated user data,
// scripted OpenAI-compatible provider) through the main chat loop —
// send task → tool call → approval → repeat approval → file writes → crash restart → recovery →
// reopen thread → history rebuild.
//
// Usage: pnpm run test:e2e   (from repository root; needs a free port 18731)
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { connect, findRendererTarget } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CDP_PORT = Number(process.env.CDP_PORT || 18731);
// Publish the resolved port so shared helpers (cdp.mjs) read THIS runner's port.
process.env.CDP_PORT = String(CDP_PORT);
// Private daemon port (IKI_DAEMON_PORT override) so the gate can run while
// the user's real app holds the default 6127.
const DAEMON_PORT = Number(process.env.IKI_E2E_DAEMON_PORT || 16127);
const FAUX_PORT = Number(process.env.IKI_E2E_FAUX_PORT || 18730);
const VITE_PORT = Number(process.env.IKI_VITE_PORT || 5173);
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (...args) => console.log('[e2e]', ...args);
const fail = message => {
  console.error('[e2e] FAIL:', message);
  process.exitCode = 1;
};

let workDir;
let fauxServer;
const launchedPids = [];

let currentStep = 'startup';
const step = name => {
  currentStep = name;
  log('step:', name);
};

const cleanup = () => {
  if (fauxServer) fauxServer.kill('SIGKILL');
  if (workDir) killAppByUserDataDir();
  // Keep the scene for post-mortem when the gate fails; on a pass remove the
  // scratch state but PRESERVE the screenshots — they are the only evidence of
  // what the UI actually looked like, and a green run is exactly when someone
  // wants to confirm it visually.
  if (workDir && !process.exitCode) {
    preserveScreenshots();
    fs.rmSync(workDir, { recursive: true, force: true });
  } else if (workDir) {
    preserveScreenshots();
    console.error('[e2e] kept failure scene:', workDir);
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
// Watchdog: nothing in this gate should take 10 minutes; a hang here means a
// wait lost its bound, and dying loudly beats awaiting forever.
const watchdog = setTimeout(() => {
  fail(`watchdog timeout at step: ${currentStep}`);
  cleanup();
  process.exit(1);
}, 10 * 60 * 1000);
watchdog.unref?.();

const portsFree = async () => {
  for (const port of [CDP_PORT, VITE_PORT, DAEMON_PORT, FAUX_PORT]) {
    try {
      const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
      if (out.trim()) return false;
    } catch {}
  }
  return true;
};

// An occupied port does not establish ownership. Never stop another dev app
// or provider to make room for the gate; use a separate checkout and ports.
const preflightPortsFree = async () => {
  if (!(await portsFree())) {
    throw new Error('e2e ports are busy; use free CDP_PORT, IKI_VITE_PORT, IKI_E2E_DAEMON_PORT and IKI_E2E_FAUX_PORT values');
  }
};

const waitForCdpPortFree = async () => {
  for (let i = 0; i < 15; i++) {
    try {
      const out = execFileSync('lsof', ['-nP', `-iTCP:${CDP_PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
      if (!out.trim()) return;
    } catch { return; }
    await sleep(1000);
  }
  throw new Error(`CDP port ${CDP_PORT} still held after killing the app; boot raced a stale instance`);
};

const killAppByUserDataDir = () => {
  // Each launch owns a POSIX process group, including npx/forge/Vite. Clear
  // the handles after stopping it so repeated cleanup cannot target a reused ID.
  for (const pid of launchedPids.splice(0)) {
    try { process.kill(-pid, 'SIGKILL'); } catch {}
  }
  // Electron helpers may detach; only the unique test profile establishes
  // ownership. Never use a global process-name pattern as a fallback.
  for (const pattern of [`user-data-dir=${workDir}/userdata`, `user-data-dir=/private${workDir}/userdata`]) {
    try {
      const out = execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' });
      for (const pid of out.split('\n').filter(Boolean)) {
        try { process.kill(Number(pid), 'SIGKILL'); } catch {}
      }
    } catch {}
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
        IKI_DAEMON_PORT: String(DAEMON_PORT),
        IKI_VITE_PORT: String(VITE_PORT),
        // Keep this run's logs in the scene dir so the gate can assert on them.
        // Without an explicit dir the app writes to the developer's real
        // ~/Library/Application Support/iki/logs and the gate cannot see what
        // it did — which is how "approval policy never wired" stayed invisible.
        IKI_LOG_DIR: path.join(workDir, 'logs'),
        MAIN_WINDOW_VITE_DEV_SERVER_URL: `http://127.0.0.1:${VITE_PORT}`,
      },
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: true,
    }
  );
  launchedPids.push(child.pid);
  const cdp = await waitForCdp(label, child);
  await applyStableViewport(cdp);
  return cdp;
};

/**
 * Pin the renderer viewport for every boot.
 *
 * The gate depended on the HOST window size before this: a small or restored
 * window made the sidebar auto-collapse (its responsive threshold sits below the
 * app's own default width), so the thread list rendered no `.chat-item` rows and
 * the restart-reopen step failed — while the same code passes on a wide window.
 * A gate must not depend on the machine it runs on. 1200 is comfortably above
 * the collapse threshold AND the restore mark, so the sidebar is expanded and
 * stable for the whole scenario.
 */
const applyStableViewport = async cdp => {
  const applied = await cdp
    .send('Emulation.setDeviceMetricsOverride', {
      width: 1200,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    })
    .then(() => true)
    .catch(() => false);
  if (!applied) log('viewport override unavailable; continuing with the host window size');
  await sleep(300);
};

/**
 * Capture a screenshot into the scene directory.
 *
 * A gate that only asserts on DOM text cannot see a layout break: the sidebar
 * toggle defect passed every text assertion while the panel was unreachable.
 * Screenshots are kept with the scene on failure and printed as paths, so a red
 * run can be LOOKED AT instead of re-derived from logs.
 */
/** Copy this run's screenshots somewhere they survive the scene cleanup. */
const preserveScreenshots = () => {
  if (!workDir) return;
  const from = path.join(workDir, 'shots');
  if (!fs.existsSync(from)) return;
  const to = path.join(ROOT, 'e2e-shots');
  try {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      fs.copyFileSync(path.join(from, name), path.join(to, name));
    }
    log(`screenshots kept in ${to}`);
  } catch (error) {
    console.error('[e2e] could not preserve screenshots:', error.message);
  }
};

const shot = async (cdp, name) => {
  const dir = path.join(workDir, 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    log(`screenshot: ${file}`);
    return file;
  } catch (error) {
    log(`screenshot ${name} failed: ${error.message}`);
    return null;
  }
};

const waitForCdp = async (label, child) => {
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`app (${label}) exited before exposing CDP: ${child.exitCode ?? child.signalCode}`);
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

const page = async (cdp, expression) => cdp.eval(expression);

const typeAndSend = async (cdp, text) => {
  const typed = await page(cdp, `(function(){
    const ta = document.querySelector('textarea');
    if (!ta) return 'NO_TEXTAREA';
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set;
    ta.focus(); setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', {bubbles: true}));
    return 'OK';
  })()`);
  if (typed !== 'OK') throw new Error('composer textarea not found');
  await sleep(300);
  const sent = await page(cdp, `(function(){
    const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')||'').toLowerCase().includes('send'));
    if (!btn || btn.disabled) return btn ? 'DISABLED' : 'NO_BUTTON';
    btn.click(); return 'OK';
  })()`);
  if (sent !== 'OK') throw new Error('send failed: ' + sent);
};

const bodyText = cdp => page(cdp, 'document.body.textContent');

const waitForDom = async (cdp, predicate, { timeoutMs = 45000, label } = {}) => {
  const start = Date.now();
  for (;;) {
    const text = await bodyText(cdp).catch(() => '');
    if (predicate(text)) return text;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(700);
  }
};

// The composer blocks sends until a model is attached to the thread. Fresh
// data does not reliably auto-attach the seeded provider, so select it
// explicitly instead of racing the boot-time auto-pick.
const ensureModelSelected = async cdp => {
  if ((await bodyText(cdp)).includes('faux-e2e-model')) return;
  await page(cdp, `(function(){
    const trigger = document.querySelector('.model-selector-trigger');
    if (!trigger) return 'NO_TRIGGER';
    trigger.click(); return 'OK';
  })()`);
  await sleep(700);
  const picked = await page(cdp, `(function(){
    const options = [...document.querySelectorAll('button, [role=option], [role=menuitem], li')];
    const target = options.find(o => /faux-e2e-model/.test(o.textContent || ''));
    if (!target) return 'NO_OPTION';
    target.click(); return 'OK';
  })()`);
  if (picked !== 'OK') throw new Error('model selection failed: ' + picked);
  await sleep(700);
  if (!(await bodyText(cdp)).includes('faux-e2e-model')) {
    throw new Error('faux-e2e-model not shown after selection');
  }
};

/**
 * Pick an approval policy by its VALUE, never by its position.
 *
 * This used to be `opts[1].click()` — "the second option is always". That
 * made the gate depend on menu ordering rather than on the policy being
 * tested: reordering or relabelling the menu silently changed which policy
 * the gate ran under, and the failure looked like a product bug. The option
 * elements now carry `data-policy`, so the selector states what it means.
 */
/**
 * Open the newest real thread from the sidebar.
 *
 * The collapsed sidebar renders NO thread rows (width 0), so it must be
 * expanded first — and expanded only while collapsed: clicking the toggle on
 * every poll reopened/closed it and the list never settled. The toggle has two
 * homes depending on layout (the sidebar's floating toolbar, or the chat
 * header's leading cluster), so it is matched by label, not by position.
 */
const openNewestThread = async cdp => {
  for (let i = 0; i < 30; i++) {
    const result = await page(cdp, `(function(){
      if (document.querySelector('.sidebar-shell-collapsed')) {
        const expandBtn =
          document.querySelector('.toolbar-container .sidebar-tool-btn') ||
          [...document.querySelectorAll('button')].find(
            b => (b.getAttribute('aria-label') || '') === 'Toggle sidebar'
          );
        if (!expandBtn) return 'NO_EXPAND_CONTROL';
        expandBtn.click();
        return 'EXPANDING';
      }
      const items = [...document.querySelectorAll('.chat-item')];
      const target =
        items.find(i => {
          const text = (i.textContent || '').trim();
          return text && !/^new chat$/i.test(text) && !/^ack\.$/i.test(text);
        }) || items.find(i => /^ack\.$/i.test((i.textContent || '').trim()));
      if (!target) return 'NO_THREAD';
      target.click();
      return 'OK';
    })()`);
    if (result === 'OK') return;
    await sleep(1000);
  }
  throw new Error('thread not found after restart');
};

const setApprovalPolicy = async (cdp, policy) => {
  const chip = await page(cdp, `(function(){
    const chip = document.querySelector('.composer-permission-chip');
    if (!chip) return 'NO_CHIP';
    chip.click(); return 'OK';
  })()`);
  if (chip !== 'OK') throw new Error('permission chip failed: ' + chip);

  // Poll like every other UI step here: the popover's options render
  // asynchronously, so a fixed sleep can observe an empty popover (NO_OPTIONS).
  let picked = 'NO_OPTIONS';
  for (let i = 0; i < 30 && picked !== 'OK'; i++) {
    picked = await page(cdp, `(function(){
      const target = document.querySelector('.permission-option[data-policy="${policy}"]');
      if (!target) {
        const seen = [...document.querySelectorAll('.permission-option')]
          .map(el => el.getAttribute('data-policy'));
        return seen.length ? 'NO_SUCH_POLICY:' + seen.join(',') : 'NO_OPTIONS';
      }
      target.click();
      return 'OK';
    })()`);
    if (picked !== 'OK') await sleep(500);
  }
  await sleep(600);
  if (picked !== 'OK') throw new Error(`permission popover failed for "${policy}": ${picked}`);

  // Read the chip back: the policy must actually be in force before the turn
  // starts, otherwise the assertions below would test whatever the default was.
  const applied = await page(cdp, `(function(){
    const selected = document.querySelector('.permission-option--selected');
    return selected ? selected.getAttribute('data-policy') : 'NONE';
  })()`);
  if (applied !== policy && applied !== 'NONE') {
    throw new Error(`approval policy "${policy}" did not stick (selected: "${applied}")`);
  }
};

const setAlwaysApprovalPolicy = cdp => setApprovalPolicy(cdp, 'always');

/**
 * The composer must always send a concrete approval policy.
 *
 * When it does not, the backend logs `chat.stream.approval_policy degraded`
 * and falls back to legacy flags. That is a silent safety downgrade with no
 * user-visible symptom, so every other assertion in this gate passed while it
 * was happening on every single tool turn. Fail the gate on it instead.
 */
const assertNoApprovalPolicyDegradation = () => {
  const logPath = path.join(workDir, 'logs/combined.log');
  if (!fs.existsSync(logPath)) {
    throw new Error(
      `app wrote no log at ${logPath} — set IKI_LOG_DIR (the gate cannot assert on behaviour it cannot see)`
    );
  }
  const degraded = fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(line => line.includes('"event":"chat.stream.approval_policy"'))
    .filter(line => line.includes('"outcome":"degraded"'));
  if (degraded.length > 0) {
    throw new Error(
      `composer sent no approval policy on ${degraded.length} tool turn(s); ` +
        `the backend degraded to legacy defaults. First: ${degraded[0].slice(0, 300)}`
    );
  }
  log('approval policy supplied on every tool turn');
};


/**
 * The turn must run on the Pi supply, and silently falling back must not happen
 * unnoticed.
 *
 * The gate's provider is an OpenAI-compatible gateway, so every turn of this
 * scenario is Pi-eligible. `llm.supply.pi_turn_fallback` means the selector
 * rejected the history and handed the turn to the AI SDK harness instead —
 * which is a legitimate safety net for out-of-domain parts, but for THIS
 * scenario (plain text and tool calls) it can only mean a projection
 * regression. Fail the gate rather than let the AI SDK quietly become the
 * executor again.
 */
const assertPiSupplyServed = () => {
  const logPath = path.join(workDir, 'logs/combined.log');
  if (!fs.existsSync(logPath)) {
    throw new Error(`app wrote no log at ${logPath}; the gate cannot assert on supply routing`);
  }
  const lines = fs.readFileSync(logPath, 'utf8').split('\n');
  const fallbacks = lines.filter(line => line.includes('llm.supply.pi_turn_fallback'));
  if (fallbacks.length > 0) {
    throw new Error(
      `Pi declined ${fallbacks.length} turn(s) that should be in its projection domain; ` +
        `the AI SDK harness served them instead. First: ${fallbacks[0].slice(0, 300)}`
    );
  }
  log('every turn ran on the Pi supply (no silent AI SDK fallback)');
};

const assertAppDatabaseReady = () => {
  const dbPath = path.join(workDir, 'userdata/iKi_v0.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`app did not create its database under the isolated user data dir (${dbPath}); --user-data-dir isolation failed`);
  }
  const db = new DatabaseSync(dbPath);
  const hasProviders = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='providers'")
    .get();
  db.close();
  if (!hasProviders) throw new Error('app database has no providers table');
};

const seedProviderAndWorkspace = () => {
  const db = new DatabaseSync(path.join(workDir, 'userdata/iKi_v0.db'));
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO providers (id, name, type, api_key, models, model_options, base_url, enabled, created_at, updated_at, available_models, api_version, is_response_api)
     VALUES (?, ?, 'openai-compatible', 'sk-e2e', ?, '{}', ?, 1, ?, ?, '[]', NULL, 0)`
  ).run('provider-faux-e2e', 'Faux E2E', JSON.stringify(['faux-e2e-model']), `http://127.0.0.1:${FAUX_PORT}/v1`, now, now);
  db.prepare(
    `INSERT OR REPLACE INTO workspaces (id, path, name, is_temporary, show_in_list, created_at, updated_at)
     VALUES ('ws-e2e', ?, 'E2E WS', 0, 1, ?, ?)`
  ).run(path.join(workDir, 'ws'), now, now);
  for (const row of db.prepare('SELECT id FROM chat_threads').all()) {
    db.prepare('UPDATE chat_threads SET workspace_id = ? WHERE id = ?').run('ws-e2e', row.id);
  }
  const enabledProviders = db.prepare('SELECT COUNT(*) c FROM providers WHERE enabled = 1').get();
  db.close();
  if (!enabledProviders || enabledProviders.c < 1) {
    throw new Error('seed self-check failed: enabled provider row not readable after insert');
  }
  log('seeded provider + workspace, threads bound');
};

const main = async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-e2e-smoke-'));
  fs.mkdirSync(path.join(workDir, 'ws'), { recursive: true });

  step('start faux provider');
  await preflightPortsFree();
  fauxServer = spawn(process.execPath, ['faux_openai_server.mjs'], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    env: { ...process.env, FAUX_PORT: String(FAUX_PORT), FAUX_LOG: path.join(workDir, 'faux.log') },
    stdio: ['ignore', fs.openSync(path.join(workDir, 'faux-stdout.log'), 'a'), fs.openSync(path.join(workDir, 'faux-stderr.log'), 'a')],
  });
  // Fail fast if the scripted provider dies at startup (its stderr is kept).
  let providerUp = false;
  for (let i = 0; i < 10; i++) {
    try {
      execFileSync('curl', ['-s', '--max-time', '1', `http://127.0.0.1:${FAUX_PORT}/v1/models`, '-o', '/dev/null']);
      providerUp = true;
      break;
    } catch {}
    await sleep(500);
  }
  if (!providerUp) throw new Error('faux provider server did not come up; see faux-stderr.log in the scene');

  // Boot once to create the full schema, then quit and seed.
  step('boot 1 (schema creation)');
  let cdp = await launchApp('boot1');
  assertAppDatabaseReady();
  cdp.close();
  await sleep(1000);
  killAppByUserDataDir();
  await waitForCdpPortFree();
  step('seed provider + workspace');
  seedProviderAndWorkspace();

  step('boot 2 (main loop)');
  cdp = await launchApp('boot2');
  assertAppDatabaseReady();
  const seeded = new DatabaseSync(path.join(workDir, 'userdata/iKi_v0.db'))
    .prepare('SELECT COUNT(*) c FROM providers WHERE enabled = 1')
    .get();
  const diagDb = new DatabaseSync(path.join(workDir, 'userdata/iKi_v0.db'));
  log(
    'providers after boot 2:',
    JSON.stringify(diagDb.prepare('SELECT id, enabled, models, available_models FROM providers').all())
  );
  diagDb.close();
  await sleep(4000);
  await ensureModelSelected(cdp);
  await shot(cdp, '01-boot2-welcome');

  // Round 1 creates the thread. Its write_file is expected to FAIL because the
  // thread has no workspace yet — but the turn must still finish so the next
  // round can run. Under the default Ask-first policy the write is gated by an
  // approval card instead of failing, and nothing answers it, so the turn
  // hangs. Pin 'never' for this round: the intent is "run the tool and let it
  // fail", not "wait for a human". Round 2 installs always-ask explicitly.
  step('round 1 (thread creation)');
  await setApprovalPolicy(cdp, 'never');
  await typeAndSend(cdp, 'E2E_TASK round1');
  await waitForDom(cdp, t => t.includes('E2E_DONE E2E_TASK round1'), { label: 'round1 completion' });
  step('bind workspace + set always-ask policy');
  seedProviderAndWorkspace(); // bind the fresh thread's workspace
  await setAlwaysApprovalPolicy(cdp);

  // Round 2 gates write_file behind an approval card — twice: after the first
  // approval the resumed turn must issue a second write_file whose approval
  // card re-renders (the awaiting-forever regression seam).
  step('round 2 (approval-gated write, repeat approval)');
  await typeAndSend(cdp, 'E2E_TASK round2');
  await waitForDom(cdp, t => (t.includes('Approve') && t.includes('write_file')), { label: 'approval card' });
  await shot(cdp, '02-round2-approval-card');
  const approved1 = await page(cdp, `(function(){
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim()==='Approve');
    if (!b) return 'NO_BTN'; b.click(); return 'OK';
  })()`);
  if (approved1 !== 'OK') throw new Error('approve click #1 failed');
  const enabledApprovePresent = () =>
    page(cdp, `(function(){
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim()==='Approve' && !x.disabled && x.offsetParent !== null);
      return b ? 'YES' : 'NO';
    })()`);
  // Wait for the first card to settle (buttons gone/disabled), then for the
  // repeat-approval card to render with a live Approve button.
  for (let i = 0; i < 30 && (await enabledApprovePresent()) === 'YES'; i++) await sleep(1000);
  if ((await enabledApprovePresent()) === 'YES') throw new Error('first approval card did not settle');
  let approved2 = 'NO_BTN';
  for (let i = 0; i < 60 && approved2 !== 'OK'; i++) {
    approved2 = await page(cdp, `(function(){
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim()==='Approve' && !x.disabled && x.offsetParent !== null);
      if (!b) return 'NO_BTN'; b.click(); return 'OK';
    })()`);
    if (approved2 !== 'OK') await sleep(1000);
  }
  if (approved2 !== 'OK') throw new Error('second approval card never rendered (repeat-approval regression)');
  log('repeat approval card rendered + approved');
  await waitForDom(cdp, t => t.includes('E2E_DONE E2E_TASK round2'), { label: 'round2 completion' });

  const written = fs.readFileSync(path.join(workDir, 'ws/e2e/hello.txt'), 'utf8');
  if (written !== 'e2e-written-by-agent') throw new Error('file content mismatch: ' + written);
  const second = fs.readFileSync(path.join(workDir, 'ws/e2e/second.txt'), 'utf8');
  if (second !== 'e2e-second-approval') throw new Error('second file content mismatch: ' + second);
  const blockedAfterApproval = new DatabaseSync(path.join(workDir, 'userdata/iKi_v0.db'))
    .prepare("SELECT id FROM agent_runs WHERE status = 'blocked'")
    .all();
  if (blockedAfterApproval.length !== 0) {
    throw new Error(
      'approved run segments remained blocked after continuation started: ' +
        JSON.stringify(blockedAfterApproval)
    );
  }
  step('crash + restart');
  log('approved writes landed on disk');

  // Crash + restart + reopen: history must rebuild with the tool exchange.
  cdp.close();
  killAppByUserDataDir();
  await sleep(1500);
  step('boot 3 (after crash)');
  cdp = await launchApp('boot3');
  await sleep(4000);
  // The sidebar thread list hydrates asynchronously after boot; poll for it.
  await openNewestThread(cdp);
  await sleep(2000);
  await shot(cdp, '03-boot3-recovered');
  const history = await bodyText(cdp);
  // A settled tool card renders its SUMMARY ("Wrote · 1 files"), not the raw
  // tool name — the name only appears while the approval card is open. Asserting
  // `write_file` here failed on a correct transcript; assert the pair the user
  // actually sees instead (prose + the settled write summary).
  if (!history.includes('Wrote')) throw new Error(
    `history does not render the settled tool card (expected a "Wrote" summary): ${history.slice(0, 400)}`
  );
  if (!history.includes('E2E_DONE E2E_TASK round2')) {
    throw new Error('history lost the round-2 completion marker');
  }

  step('history check turn');
  await typeAndSend(cdp, 'CHECK_HISTORY');
  const report = await waitForDom(cdp, t => t.includes('HISTORY_REPORT[CHECK_HISTORY]'), { label: 'history report' });
  // The transcript already renders earlier turns' numbers; read THIS turn's
  // report by taking the last counts in the body text.
  const readReportCounts = text => ({
    toolMsgs: [...text.matchAll(/tool_msgs=(\d+)/g)].map(m => Number(m[1])).at(-1) ?? 0,
    toolCalls: [...text.matchAll(/assistant_tool_calls=(\d+)/g)].map(m => Number(m[1])).at(-1) ?? 0,
  });
  const { toolMsgs, toolCalls } = readReportCounts(report);
  if (toolMsgs < 1 || toolCalls < 1 || toolMsgs !== toolCalls) {
    throw new Error(`history rebuild mismatch: tool_msgs=${toolMsgs} assistant_tool_calls=${toolCalls}`);
  }

  // Round 3: crash while an approval is PENDING. Restart recovery must close
  // the card (system rejection), mark the tool call as a terminal error in
  // the transcript, and the next turn feeds that error back to the model.
  step('round 3 (crash while approval pending)');
  await typeAndSend(cdp, 'E2E_TASK round3');
  await waitForDom(cdp, t => (t.includes('Approve') && t.includes('write_file')), { label: 'round3 approval card' });
  cdp.close();
  killAppByUserDataDir();
  await sleep(1500);
  step('boot 4 (recovery)');
  cdp = await launchApp('boot4');
  await sleep(4000);
  await openNewestThread(cdp);
  await sleep(2000);

  const recoveredBody = await bodyText(cdp);
  if (!recoveredBody.includes('never executed')) {
    throw new Error('interrupted approval tool not marked with a terminal error in the transcript');
  }
  const zombie = await page(cdp, `(function(){
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim()==='Approve' && !x.disabled && x.offsetParent !== null);
    return b ? 'ZOMBIE' : 'OK';
  })()`);
  if (zombie !== 'OK') throw new Error('approval card still answerable after restart');
  // A pause is memory-only, so a restart must leave no approval the app can
  // still answer. The zombie-button probe above proves that from the UI side;
  // this proves the tables a pause used to need are gone from the schema.
  const leftoverTables = new DatabaseSync(path.join(workDir, 'userdata/iKi_v0.db'))
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'tool_call_approval%'")
    .all();
  if (leftoverTables.length !== 0) {
    throw new Error(`approval tables still present after migration: ${JSON.stringify(leftoverTables)}`);
  }

  // F4 (ADR 008 flip): the restart recovery must record its facts in the
  // session log — the expired approvals as system-sourced approval_decided
  // events, and a terminal fact for each reclaimed run.
  {
    const eventDb = new DatabaseSync(path.join(workDir, 'userdata/iKi_v0.db'));
    try {
      const decidedRows = eventDb
        .prepare("SELECT payload FROM session_events WHERE type = 'approval_decided'")
        .all();
      const systemDecided = decidedRows.filter(row => {
        try {
          return JSON.parse(row.payload).source === 'system';
        } catch {
          return false;
        }
      });
      if (systemDecided.length === 0) {
        throw new Error(
          'restart recovery recorded no system-sourced approval decisions in the session log'
        );
      }
      // Scoped to the RECLAIMED runs: the recovery terminal carries the
      // reclamation message — 'Run interrupted by process restart' for
      // running runs, 'Run blocked at restart — approval session lost' for
      // blocked ones (round 3 crashes while approval-pending, so blocked).
      const reclaimedTerminals = eventDb
        .prepare(
          "SELECT payload FROM session_events WHERE type = 'turn_failed' AND (json_extract(payload, '$.errorText') LIKE '%process restart%' OR json_extract(payload, '$.errorText') LIKE '%approval session lost%')"
        )
        .all();
      if (reclaimedTerminals.length === 0) {
        throw new Error(
          'restart recovery recorded no terminal fact for the reclaimed runs in the session log'
        );
      }
    } finally {
      eventDb.close();
    }
  }

  step('post-recovery continuation turn');
  await typeAndSend(cdp, 'CHECK_HISTORY2');
  const report2 = await waitForDom(cdp, t => t.includes('HISTORY_REPORT[CHECK_HISTORY2]'), { label: 'post-recovery history report' });
  const { toolMsgs: toolMsgs2, toolCalls: toolCalls2 } = readReportCounts(report2);
  // The interrupted call must appear as a paired error exchange (the model
  // received it and the loop continued), matching every other exchange 1:1.
  if (toolMsgs2 <= toolMsgs || toolMsgs2 !== toolCalls2) {
    throw new Error(`post-recovery mismatch: tool_msgs=${toolMsgs2} assistant_tool_calls=${toolCalls2} (pre-recovery ${toolMsgs})`);
  }
  cdp.close();

  step('assert no approval-policy degradation in the app log');
  assertNoApprovalPolicyDegradation();

  step('assert the turn ran on the Pi supply');
  assertPiSupplyServed();

  clearTimeout(watchdog);
  log(`PASS — approval loop, restart failure semantics, and crash recovery verified (tool pairs: ${toolMsgs2})`);
};

try {
  await main();
} catch (error) {
  fail(`at step [${currentStep}]: ${error.message}`);
} finally {
  cleanup();
}
