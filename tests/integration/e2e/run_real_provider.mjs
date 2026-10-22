// Real-provider e2e: drives the actual Electron app against a REAL
// OpenAI-compatible router (default http://127.0.0.1:3425/v1) instead of the
// scripted faux server. The point is to find problems that only a live model
// exposes — non-deterministic replies, real tool-call shapes, streaming
// quirks, and the harness behaviour around them.
//
// Unlike run_smoke.mjs this is NOT a fixed-script gate: the model decides what
// to say, so assertions check for structural outcomes (a reply arrived, a tool
// call was made, history survived a restart) rather than exact strings.
//
// Usage:
//   IKI_REAL_ROUTER_URL=http://127.0.0.1:3425/v1 \
//   IKI_REAL_ROUTER_MODEL=workbuddy/step-5-preview \
//   node tests/integration/e2e/run_real_provider.mjs
//
// Ports default to values distinct from run_smoke.mjs so the two can run
// side by side. Override with CDP_PORT / IKI_VITE_PORT / IKI_E2E_DAEMON_PORT.
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { connect, findRendererTarget } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const CDP_PORT = Number(process.env.CDP_PORT || 18741);
// Publish the resolved port so shared helpers (cdp.mjs) read THIS runner's port.
process.env.CDP_PORT = String(CDP_PORT);

const DAEMON_PORT = Number(process.env.IKI_E2E_DAEMON_PORT || 16137);
const VITE_PORT = Number(process.env.IKI_VITE_PORT || 5177);
const ROUTER_URL = (process.env.IKI_REAL_ROUTER_URL || 'http://127.0.0.1:3425/v1').replace(/\/+$/, '');
const ROUTER_KEY = process.env.IKI_REAL_ROUTER_KEY || 'real-e2e';
const MODEL = process.env.IKI_REAL_ROUTER_MODEL || 'workbuddy/step-5-preview';
const PROVIDER_ID = 'provider-real-e2e';
const PROVIDER_NAME = 'Real Router E2E';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (...args) => console.log('[real-e2e]', ...args);
const fail = message => {
  console.error('[real-e2e] FAIL:', message);
  process.exitCode = 1;
};

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
    console.error('[real-e2e] kept failure scene:', workDir);
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
// A live model can be slow; 15 minutes is generous but bounded.
const watchdog = setTimeout(() => {
  fail(`watchdog timeout at step: ${currentStep}`);
  cleanup();
  process.exit(1);
}, 15 * 60 * 1000);
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
  for (const port of [CDP_PORT, VITE_PORT, DAEMON_PORT]) {
    if (portBusy(port)) {
      throw new Error(
        `port ${port} is busy; set CDP_PORT / IKI_VITE_PORT / IKI_E2E_DAEMON_PORT to free values`
      );
    }
  }
};

const waitForCdpPortFree = async () => {
  for (let i = 0; i < 15; i++) {
    if (!portBusy(CDP_PORT)) return;
    await sleep(1000);
  }
  throw new Error(`CDP port ${CDP_PORT} still held after killing the app`);
};

const killAppByUserDataDir = () => {
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
};

const launchApp = async label => {
  const child = spawn(
    'npx',
    [
      'electron-forge',
      'start',
      '--',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${workDir}/userdata`,
    ],
    {
      cwd: path.join(ROOT, 'packages/desktop'),
      env: {
        ...process.env,
        IKI_DAEMON_PORT: String(DAEMON_PORT),
        IKI_VITE_PORT: String(VITE_PORT),
        MAIN_WINDOW_VITE_DEV_SERVER_URL: `http://127.0.0.1:${VITE_PORT}`,
        // The gate drives the UI over CDP; an auto-opened dock only gets in the way.
        IKI_AUTO_OPEN_DEVTOOLS: 'false',
      },
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: true,
    }
  );
  launchedPids.push(child.pid);
  return await waitForCdp(label, child);
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

const page = (cdp, expression) => cdp.eval(expression);
const bodyText = cdp => page(cdp, 'document.body.textContent');

const waitForDom = async (cdp, predicate, { timeoutMs = 120000, label } = {}) => {
  const start = Date.now();
  for (;;) {
    const text = await bodyText(cdp).catch(() => '');
    if (predicate(text)) return text;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(1000);
  }
};

// Poll a synchronous probe (e.g. a fresh SQLite read) until it returns truthy.
const waitFor = async (probe, { timeoutMs = 180000, label } = {}) => {
  const start = Date.now();
  for (;;) {
    const value = await Promise.resolve()
      .then(probe)
      .catch(() => null);
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(1500);
  }
};

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

// typeAndSend only proves the button click landed. Right after an
// approval-resume commit the composer can be mid-settle (Vue state lag), and
// the click is swallowed with no error. This variant RETRIES until the user
// row actually persists in the DB — the send is acknowledged, not assumed.
const typeAndSendAcknowledged = async (cdp, text, { attempts = 3, label } = {}) => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const before = db()
      .prepare("SELECT COUNT(*) c FROM chat_messages WHERE json_extract(message, '$.role') = 'user'")
      .get().c;
    await typeAndSend(cdp, text);
    try {
      await waitFor(
        () => {
          const d = db();
          try {
            return (
              d.prepare(
                "SELECT COUNT(*) c FROM chat_messages WHERE json_extract(message, '$.role') = 'user'"
              ).get().c > before
            )
              ? true
              : null;
          } finally {
            d.close();
          }
        },
        { timeoutMs: 20000, label: `${label} user row persisted (attempt ${attempt})` }
      );
      return;
    } catch {
      if (attempt === attempts) throw new Error(`send never acknowledged after ${attempts} attempts: ${label}`);
      log(`send not acknowledged (attempt ${attempt}) — retrying ${label}`);
      await sleep(2000);
    }
  }
};

// The composer refuses to send without a model. Pick ours explicitly rather
// than racing the boot-time auto-pick.
const ensureModelSelected = async cdp => {
  if ((await bodyText(cdp)).includes(MODEL)) return;
  await page(cdp, `(function(){
    const trigger = document.querySelector('.model-selector-trigger');
    if (!trigger) return 'NO_TRIGGER';
    trigger.click(); return 'OK';
  })()`);
  await sleep(700);
  const picked = await page(cdp, `(function(){
    const options = [...document.querySelectorAll('button, [role=option], [role=menuitem], li')];
    const target = options.find(o => (o.textContent || '').includes(${JSON.stringify(MODEL)}));
    if (!target) return 'NO_OPTION';
    target.click(); return 'OK';
  })()`);
  if (picked !== 'OK') throw new Error('model selection failed: ' + picked);
  await sleep(700);
  if (!(await bodyText(cdp)).includes(MODEL)) {
    throw new Error(`${MODEL} not shown after selection`);
  }
};

const assertAppDatabaseReady = () => {
  const dbPath = path.join(workDir, 'userdata/iKi_v0.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`app did not create its database under the isolated user data dir (${dbPath})`);
  }
  const db = new DatabaseSync(dbPath);
  const hasProviders = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='providers'")
    .get();
  db.close();
  if (!hasProviders) throw new Error('app database has no providers table');
};

const db = () => new DatabaseSync(path.join(workDir, 'userdata/iKi_v0.db'));

const seedProviderAndWorkspace = () => {
  const now = new Date().toISOString();
  const database = db();
  database
    .prepare(
      `INSERT OR REPLACE INTO providers (id, name, type, api_key, models, model_options, base_url, enabled, created_at, updated_at, available_models, api_version, is_response_api)
       VALUES (?, ?, 'openai-compatible', ?, ?, '{}', ?, 1, ?, ?, '[]', NULL, 0)`
    )
    .run(
      PROVIDER_ID,
      PROVIDER_NAME,
      ROUTER_KEY,
      JSON.stringify([MODEL]),
      ROUTER_URL,
      now,
      now
    );
  database
    .prepare(
      `INSERT OR REPLACE INTO workspaces (id, path, name, is_temporary, show_in_list, created_at, updated_at)
       VALUES ('ws-real-e2e', ?, 'Real E2E WS', 0, 1, ?, ?)`
    )
    .run(path.join(workDir, 'ws'), now, now);
  // NOTE: no thread binding here — at seed time NO chat thread exists yet
  // (the UI creates one on the first send), so an UPDATE here would be a
  // silent no-op (this was a real defect: the model correctly refused tools
  // with "no workspace is selected"). Bind after turn 1 creates the thread,
  // the way run_smoke.mjs orders create → bind.
  const enabled = database.prepare('SELECT COUNT(*) c FROM providers WHERE enabled = 1').get();
  database.close();
  if (!enabled || enabled.c < 1) throw new Error('seed self-check failed: enabled provider row not readable');
  log('seeded real provider + workspace');
};

const bindWorkspaceToThreads = () => {
  const database = db();
  const rows = database.prepare('SELECT id FROM chat_threads').all();
  for (const row of rows) {
    database
      .prepare('UPDATE chat_threads SET workspace_id = ? WHERE id = ?')
      .run('ws-real-e2e', row.id);
  }
  database.close();
  if (rows.length < 1) {
    throw new Error('bind self-check failed: no chat thread exists to bind after turn 1');
  }
  log(`bound ${rows.length} thread(s) to ws-real-e2e`);
};

const main = async () => {
  // Fail before launching anything if the router is not answering.
  step('router reachability');
  try {
    const res = await fetch(`${ROUTER_URL}/models`, {
      headers: { authorization: `Bearer ${ROUTER_KEY}` },
    });
    if (!res.ok) throw new Error(`GET /models -> ${res.status}`);
  } catch (error) {
    throw new Error(`real router at ${ROUTER_URL} is not reachable: ${error.message}`);
  }
  log(`router OK: ${ROUTER_URL} (model ${MODEL})`);

  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-real-e2e-'));
  fs.mkdirSync(path.join(workDir, 'ws'), { recursive: true });

  step('boot 1 (schema creation)');
  preflightPortsFree();
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
  const diag = db();
  log(
    'providers after boot 2:',
    JSON.stringify(diag.prepare('SELECT id, enabled, models FROM providers').all())
  );
  diag.close();
  await sleep(5000);
  await ensureModelSelected(cdp);

  // Turn 1: a plain conversational turn. Wait on the PERSISTED assistant row,
  // not on body text: the prompt itself contains "hello", so a text predicate
  // matched the user's own bubble one second after send and the run raced its
  // own cleanup. db() opens a fresh connection per call, so it sees new writes.
  step('turn 1 (plain conversation)');
  await typeAndSend(cdp, 'Say hello in one short sentence. Do not use any tools.');
  const assistantRow1 = await waitFor(
    () => {
      const d = db();
      try {
        return d
          .prepare(
            "SELECT message FROM chat_messages WHERE json_extract(message, '$.role') = 'assistant' LIMIT 1"
          )
          .get();
      } finally {
        d.close();
      }
    },
    { label: 'persisted assistant message after turn 1' }
  );
  const assistantText1 = JSON.parse(assistantRow1.message)
    .parts.filter(p => p.type === 'text')
    .map(p => p.text)
    .join('')
    .trim();
  log('assistant reply after turn 1:', JSON.stringify(assistantText1.slice(0, 120)));
  if (!assistantText1) throw new Error('assistant message persisted but with empty text');
  await waitForDom(cdp, t => t.includes(assistantText1.slice(0, 40)), {
    label: 'assistant reply rendered in the UI',
  });

  // The first send created the thread — now the workspace binding is real.
  // Turn 2 (tool path) only exercises anything with a bound workspace; the
  // model refusing without one is correct behavior, not a flake to retry.
  bindWorkspaceToThreads();

  // Turn 2: force a real tool call. The workspace is bound, so write_file
  // should be allowed; the approval policy defaults to asking, so this also
  // exercises the approval card end-to-end against a live model.
  step('turn 2 (tool call + approval)');
  const targetFile = path.join(workDir, 'ws/real-e2e/note.txt');
  await typeAndSend(
    cdp,
    'Use the write_file tool to create the file real-e2e/note.txt with the content: written-by-real-router. You must call write_file.'
  );

  const approvalAppeared = await waitForDom(
    cdp,
    t => t.includes('Approve') && /write_file/.test(t),
    { label: 'approval card for write_file' }
  ).then(
    () => true,
    () => false
  );
  if (!approvalAppeared) {
    // The model may have answered without calling the tool. That is not a
    // harness failure, but it does mean the tool path went unexercised, so
    // report it loudly instead of silently passing.
    log('WARN: no approval card rendered — the model did not call write_file');
  } else {
    log('approval card rendered for write_file');
    const approved = await page(cdp, `(function(){
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim()==='Approve' && !x.disabled && x.offsetParent !== null);
      if (!b) return 'NO_BTN'; b.click(); return 'OK';
    })()`);
    if (approved !== 'OK') throw new Error('approve click failed');

    // Wait for the tool to land on disk.
    let written = null;
    for (let i = 0; i < 60 && written === null; i++) {
      if (fs.existsSync(targetFile)) {
        written = fs.readFileSync(targetFile, 'utf8');
        break;
      }
      await sleep(1000);
    }
    if (written === null) {
      throw new Error('approved write_file never produced the file on disk');
    }
    if (!/written-by-real-router/.test(written)) {
      throw new Error('file content mismatch: ' + JSON.stringify(written));
    }
    log('approved write landed on disk:', JSON.stringify(written));
  }

  // Turn 3: the model must see the previous turns. This is the property that
  // breaks when history is dropped between turns. Assert on the PERSISTED
  // turn-3 ASSISTANT TEXT, not body text and not a raw LIKE on the message:
  // the turn-2 assistant row already carries the token inside its write_file
  // tool-call input, so any weaker check would true-match before the model
  // ever recalled anything.
  step('turn 3 (history continuity)');
  const TOKEN3 = 'written-by-real-router';
  // Baseline BEFORE send: turn 2's own assistant text already quotes the
  // token ("Created note.txt with the content written-by-real-router"), so
  // scanning the newest row without an anchor true-matches instantly. Only
  // assistant rows created AFTER this point may satisfy the check.
  const baseline = db().prepare('SELECT MAX(rowid) m FROM chat_messages').get().m;
  await typeAndSendAcknowledged(
    cdp,
    `In one short sentence: what was the exact content string I asked you to write into real-e2e/note.txt? Answer from our conversation history only. If you could not write the file, still quote the exact content string I asked for.`,
    { label: 'turn 3' }
  );
  const historyRow = await waitFor(
    () => {
      const d = db();
      try {
        const rows = d
          .prepare(
            "SELECT message FROM chat_messages WHERE rowid > ? AND json_extract(message, '$.role') = 'assistant' ORDER BY rowid"
          )
          .all(baseline);
        for (const last of rows) {
          const m = JSON.parse(last.message);
          const text = (m.parts || [])
            .filter(p => p.type === 'text')
            .map(p => p.text)
            .join('');
          if (text.includes(TOKEN3)) return { text };
        }
        return null;
      } finally {
        d.close();
      }
    },
    { label: 'model recalling the earlier content (turn-3 assistant text)' }
  );
  log('history continuity confirmed:', JSON.stringify(historyRow.text.slice(0, 120)));

  // Restart: history must rebuild from the database with the tool exchange
  // intact, and no approval may be left answerable.
  step('restart + recovery');
  cdp.close();
  killAppByUserDataDir();
  await sleep(1500);
  cdp = await launchApp('boot3');
  await sleep(5000);

  // Same state machine as run_smoke's openNewestThread: the collapsed sidebar
  // renders NO thread rows, and the toggle must be clicked ONLY while collapsed
  // (clicking every poll reopens/closes it and the list never settles).
  // The toggle lives in two places depending on layout, so match by label too.
  let opened = 'NO_THREAD';
  for (let i = 0; i < 40 && opened !== 'OK'; i++) {
    opened = await page(cdp, `(function(){
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
      const target = items.find(i => {
        const text = (i.textContent || '').trim();
        return text && !/^new chat$/i.test(text);
      });
      if (!target) return 'NO_THREAD'; target.click(); return 'OK';
    })()`);
    if (opened !== 'OK') await sleep(1000);
  }
  if (opened !== 'OK') throw new Error('thread not found after restart');
  await sleep(2500);

  const rebuilt = await bodyText(cdp);
  if (!/written-by-real-router/.test(rebuilt)) {
    throw new Error('thread history did not rebuild the earlier turns after restart');
  }
  if (approvalAppeared && !/write_file/.test(rebuilt)) {
    throw new Error('thread history does not render the tool card after restart');
  }
  log('history rebuilt after restart');

  const zombie = await page(cdp, `(function(){
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim()==='Approve' && !x.disabled && x.offsetParent !== null);
    return b ? 'ZOMBIE' : 'OK';
  })()`);
  if (zombie !== 'OK') throw new Error('approval card still answerable after restart');

  const leftoverPending = db()
    .prepare("SELECT approval_id FROM tool_call_approvals WHERE state = 'pending'")
    .all();
  if (leftoverPending.length !== 0) {
    throw new Error(`pending approvals survived restart: ${JSON.stringify(leftoverPending)}`);
  }

  // A final turn after recovery: the app is still usable end to end.
  step('post-recovery turn');
  await typeAndSend(cdp, 'Reply with the single word: RECOVERED');
  await waitForDom(cdp, t => /RECOVERED/i.test(t), { label: 'post-recovery reply' });

  cdp.close();
  clearTimeout(watchdog);
  log('PASS — real-provider conversation, tool approval, and restart recovery verified');
};

try {
  await main();
} catch (error) {
  fail(`at step [${currentStep}]: ${error.message}`);
} finally {
  cleanup();
}
