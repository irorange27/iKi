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
const CDP_PORT = 18731;
// Private daemon port (IKI_DAEMON_PORT override) so the gate can run while
// the user's real app holds the default 6127.
const DAEMON_PORT = 16127;
const FAUX_PORT = 18730;
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
  for (const pid of launchedPids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  if (workDir) killAppByUserDataDir();
  // Keep the scene for post-mortem when the gate fails; remove on pass.
  if (workDir && !process.exitCode) {
    fs.rmSync(workDir, { recursive: true, force: true });
  } else if (workDir) {
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
  for (const port of [CDP_PORT, 5173, DAEMON_PORT]) {
    try {
      const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
      if (out.trim()) return false;
    } catch {}
  }
  return true;
};

// A previous run's Electron/vite children outlive their npx parents; a new
// boot then flashes (port taken) and the CDP driver silently attaches to the
// stale instance. Refuse to start until the ports are actually free.
const preflightPortsFree = async () => {
  for (let i = 0; i < 15; i++) {
    if (await portsFree()) return;
    log(`ports busy (attempt ${i + 1}); killing stale e2e instances`);
    try {
      const out = execFileSync('pgrep', ['-f', `remote-debugging-port=${CDP_PORT}`], { encoding: 'utf8' });
      for (const pid of out.split('\n').filter(Boolean)) {
        try { process.kill(Number(pid), 'SIGKILL'); } catch {}
      }
    } catch {}
    try { execFileSync('pkill', ['-9', '-f', 'electron-forge start']); } catch {}
    await sleep(2000);
  }
  throw new Error('e2e ports still busy after cleanup; another iKi dev instance may be running');
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
  // The user-data-dir is unique per run, so the pattern targets exactly this
  // app instance (forge's electron child outlives its parent on kill).
  // Chromium helpers normalize the temp path through /private/var while the
  // main process keeps the raw argv, so match both spellings plus the forge
  // parent chain — leftovers hold the ports and the next boot flash-dies
  // into a dual-instance race.
  for (const pattern of [`user-data-dir=${workDir}/userdata`, `user-data-dir=/private${workDir}/userdata`]) {
    try {
      const out = execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' });
      for (const pid of out.split('\n').filter(Boolean)) {
        try { process.kill(Number(pid), 'SIGKILL'); } catch {}
      }
    } catch {}
  }
  try { execFileSync('pkill', ['-9', '-f', 'electron-forge start']); } catch {}
};

const launchApp = async label => {
  const child = spawn(
    'npx',
    ['electron-forge', 'start', '--', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${workDir}/userdata`],
    {
      cwd: path.join(ROOT, 'packages/desktop'),
      env: { ...process.env, IKI_DAEMON_PORT: String(DAEMON_PORT) },
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: false,
    }
  );
  launchedPids.push(child.pid);
  const cdp = await waitForCdp(label);
  return cdp;
};

const waitForCdp = async label => {
  for (let i = 0; i < 90; i++) {
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

const setAlwaysApprovalPolicy = async cdp => {
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
      const opts = [...document.querySelectorAll('.permission-option')];
      if (!opts.length) return 'NO_OPTIONS';
      opts[1].click();  // 'always'
      return 'OK';
    })()`);
    if (picked !== 'OK') await sleep(500);
  }
  await sleep(600);
  if (picked !== 'OK') throw new Error('permission popover failed: ' + picked);
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
    `INSERT OR REPLACE INTO providers (id, name, type, api_key, models, model_options, base_url, enabled, created_at, updated_at, available_models, api_version, is_response_api, acp_command, acp_args, acp_mcp_server_ids, acp_auth_method_id, acp_api_provider_id, acp_model_mapping)
     VALUES (?, ?, 'openai-compatible', 'sk-e2e', ?, '{}', ?, 1, ?, ?, '[]', NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL)`
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

  // Round 1 creates the thread; the tool fails (no workspace at turn time).
  step('round 1 (thread creation)');
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
  let opened = 'NO_THREAD';
  for (let i = 0; i < 30 && opened !== 'OK'; i++) {
    opened = await page(cdp, `(function(){
      // Title generation may rewrite the title; pick the newest real thread.
      const items = [...document.querySelectorAll('.chat-item')];
      const target = items.find(i => {
        const text = (i.textContent || '').trim();
        return text && !/^new chat$/i.test(text) && !/^ack\.$/i.test(text);
      }) || items.find(i => /^ack\.$/i.test((i.textContent || '').trim()));
      if (!target) return 'NO_THREAD'; target.click(); return 'OK';
    })()`);
    if (opened !== 'OK') await sleep(1000);
  }
  if (opened !== 'OK') throw new Error('thread not found after restart');
  await sleep(2000);
  const history = await bodyText(cdp);
  if (!history.includes('write_file')) throw new Error('history does not render the tool card');

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
  let reopened = 'NO_THREAD';
  for (let i = 0; i < 30 && reopened !== 'OK'; i++) {
    reopened = await page(cdp, `(function(){
      const items = [...document.querySelectorAll('.chat-item')];
      const target = items.find(i => {
        const text = (i.textContent || '').trim();
        return text && !/^new chat$/i.test(text) && !/^ack\.$/i.test(text);
      }) || items.find(i => /^ack\.$/i.test((i.textContent || '').trim()));
      if (!target) return 'NO_THREAD'; target.click(); return 'OK';
    })()`);
    if (reopened !== 'OK') await sleep(1000);
  }
  if (reopened !== 'OK') throw new Error('thread not found after recovery boot');
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
  const leftoverPending = new DatabaseSync(path.join(workDir, 'userdata/iKi_v0.db'))
    .prepare("SELECT approval_id FROM tool_call_approvals WHERE state = 'pending'")
    .all();
  if (leftoverPending.length !== 0) {
    throw new Error(`pending approvals survived restart: ${JSON.stringify(leftoverPending)}`);
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
  clearTimeout(watchdog);
  log(`PASS — approval loop + crash-restart recovery verified (tool pairs: ${toolMsgs2})`);
};

try {
  await main();
} catch (error) {
  fail(`at step [${currentStep}]: ${error.message}`);
} finally {
  cleanup();
}
