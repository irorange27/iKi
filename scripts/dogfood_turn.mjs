#!/usr/bin/env node
// Headless dogfood turn: drive one real iKi agent turn through the daemon API
// against an ISOLATED user-data dir, and report whether it actually worked.
//
// Two modes (docs/dogfood.md §A):
//   • default — point at an EXTERNAL daemon you booted (--daemon-url + the
//     --user-data dir it booted with). This script boots nothing and never
//     deletes that dir.
//   • --spawn-daemon <port> — opt in to a self-owned fresh scene: the script
//     makes a temp user-data dir, boots the daemon, and tears both down on
//     success (a failure scene is kept and its path printed).
//
// The loop: register client → seed provider + workspace rows → create a thread
// already bound to that workspace → drive the turn over WS → answer tool
// approvals → print transcript + summary. Exit 0 only on a clean stream-result.
//
// Model / endpoint / key come from env or flags, never from this file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
// Named import, not default: the repo lint flags shadowing the module's own
// `WebSocket` export, and Node's global WebSocket ignores the `headers` option
// this client needs for bearer auth.
import { WebSocket } from 'ws';

const PROVIDER_TYPE = 'openai-compatible';
const PROVIDER_ID = 'provider-dogfood';
const WORKSPACE_ID = 'ws-dogfood';
const SCOPES = ['chat:read', 'chat:write', 'memory:read', 'tools:run', 'tools:approve'];
const DEFAULT_TOOLS = ['read_file', 'write_file', 'edit', 'shell'];
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `dogfood_turn — drive one headless iKi turn through the daemon API

Modes
  default:          talk to an already-running daemon (--daemon-url + --user-data
                    pointing at the dir that daemon booted with)
  --spawn-daemon:   the script boots its own daemon over a fresh temp user-data
                    dir and cleans it up when the turn succeeds

Options
  --daemon-url <url>      daemon base URL       [env DOGFOOD_DAEMON_URL, default http://127.0.0.1:6127]
  --user-data <dir>       that daemon's dir     [env DOGFOOD_USER_DATA] (required, default mode)
  --spawn-daemon <port>   boot a private daemon on <port> instead
  --provider-base-url <u> OpenAI-compatible base URL ending in /v1  [env DOGFOOD_BASE_URL] (required)
  --model <name>          model id on that endpoint                 [env DOGFOOD_MODEL]    (required)
  --provider-key <key>    providers.api_key value   [env DOGFOOD_API_KEY, default sk-dogfood]
  --workspace <path>      dir the tools are scoped to [default: cwd]
  --tools <a,b,c>         tools to offer        [default ${DEFAULT_TOOLS.join(', ')}]
  --approve               approve every tool approval [default: deny and report blocked]
  --timeout <seconds>     turn deadline          [default 240]
  --keep                  keep the temp scene after a successful --spawn-daemon run
  -h, --help              this text

Last positional argument is the task prompt.

Example (external daemon):
  IKI_USER_DATA_PATH=/tmp/iki-dogfood-turn/userdata IKI_DAEMON_PORT=16311 pnpm run daemon:start &
  DOGFOOD_MODEL=... DOGFOOD_BASE_URL=https://.../v1 pnpm run dogfood:turn -- \\
    --daemon-url http://127.0.0.1:16311 --user-data /tmp/iki-dogfood-turn/userdata \\
    --approve "Read package.json and report the version."`;

const parseArgs = argv => {
  const opts = {
    daemonUrl: process.env.DOGFOOD_DAEMON_URL || 'http://127.0.0.1:6127',
    userData: process.env.DOGFOOD_USER_DATA || '',
    spawnPort: 0,
    baseUrl: process.env.DOGFOOD_BASE_URL || '',
    model: process.env.DOGFOOD_MODEL || '',
    apiKey: process.env.DOGFOOD_API_KEY || 'sk-dogfood',
    workspace: process.cwd(),
    tools: [...DEFAULT_TOOLS],
    approve: false,
    timeoutSec: 240,
    keep: false,
    help: false,
    task: '',
  };
  const value = (i, name) => {
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) die(`${name} needs a value`, '--help');
    return next;
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--daemon-url') opts.daemonUrl = value(i++, arg);
    else if (arg === '--user-data') opts.userData = value(i++, arg);
    else if (arg === '--spawn-daemon') {
      opts.spawnPort = Number(value(i++, arg));
      if (!Number.isInteger(opts.spawnPort) || opts.spawnPort < 1 || opts.spawnPort > 65535) {
        die('--spawn-daemon needs a port number');
      }
    } else if (arg === '--provider-base-url') opts.baseUrl = value(i++, arg);
    else if (arg === '--model') opts.model = value(i++, arg);
    else if (arg === '--provider-key') opts.apiKey = value(i++, arg);
    else if (arg === '--workspace') opts.workspace = path.resolve(value(i++, arg));
    else if (arg === '--tools') {
      opts.tools = value(i++, arg)
        .split(',')
        .map(tool => tool.trim())
        .filter(Boolean);
    } else if (arg === '--timeout') {
      opts.timeoutSec = Number(value(i++, arg));
      if (!Number.isFinite(opts.timeoutSec) || opts.timeoutSec <= 0) {
        die('--timeout must be a positive number of seconds');
      }
    } else if (arg === '--approve') opts.approve = true;
    else if (arg === '--keep') opts.keep = true;
    else if (arg.startsWith('--')) die(`Unknown flag: ${arg}`, '--help');
    else positional.push(arg);
  }
  opts.task = positional.join(' ').trim();
  return opts;
};

const die = (message, hint) => {
  console.error(`[dogfood] FAIL: ${message}${hint ? `\n[dogfood] hint: ${hint}` : ''}`);
  process.exit(2);
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Best-effort: closing/killing during teardown can race the peer and throw; the
// outcome we want (socket down, child stopped) is already in motion.
const safeClose = socket => {
  try {
    socket.close();
  } catch {
    /* already closing */
  }
};
const safeKill = child => {
  try {
    child.kill('SIGTERM');
  } catch {
    /* already exited */
  }
};

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
if (!opts.task) die('no task given', 'pass the prompt as the last argument, or --help');
if (!opts.baseUrl) {
  die(
    'no provider base URL: pass --provider-base-url or set DOGFOOD_BASE_URL',
    'an OpenAI-compatible endpoint ending in /v1 — never commit a key or a router URL here'
  );
}
if (!opts.model) die('no model: pass --model or set DOGFOOD_MODEL', 'it must exist on that endpoint');
if (!opts.spawnPort && !opts.userData) {
  die(
    'no --user-data: this script will not guess which dir the daemon booted with',
    'boot one and pass its dir, or use --spawn-daemon <port>'
  );
}
if (!fs.existsSync(opts.workspace)) die(`workspace path does not exist: ${opts.workspace}`);

// Spawn mode owns the scene end-to-end: the URL always follows the port we
// passed to the daemon, so a stale --daemon-url cannot make the health poll
// watch a different (possibly someone else's) daemon.
if (opts.spawnPort) opts.daemonUrl = `http://127.0.0.1:${opts.spawnPort}`;

const daemonUrl = opts.daemonUrl.replace(/\/+$/, '');
const wsUrl = `${daemonUrl.replace(/^http/, 'ws')}/v1/chat/stream`;

// ── scene ────────────────────────────────────────────────────────────────────
// In spawn mode the scene is ours: a fresh temp dir plus the daemon we booted
// into it, both removed on success. In default mode nothing here is deleted.
const tmpRoot = fs.realpathSync(os.tmpdir());
const userData = opts.spawnPort
  ? fs.mkdtempSync(path.join(tmpRoot, 'iki-dogfood-turn-'))
  : path.resolve(opts.userData);

let daemonChild = null;
let dirKept = false;
// True once this script deliberately SIGTERMs the daemon it spawned, so the
// child's expected 143 exit is not reported as a surprise.
let stoppingDaemon = false;

const keepScene = reason => {
  dirKept = true;
  console.error(`[dogfood] scene kept (${reason}): ${userData}`);
  if (opts.spawnPort) {
    console.error(
      `[dogfood] to inspect it: IKI_USER_DATA_PATH=${userData} IKI_DAEMON_PORT=<port> pnpm run daemon:start`
    );
  }
};

// A daemon this script spawned is always stopped, even on failure: what stays
// for inspection is the user-data dir, and it re-boots over the same dir.
const stopDaemon = () => {
  if (!daemonChild || daemonChild.exitCode !== null || daemonChild.signalCode) return;
  stoppingDaemon = true;
  safeKill(daemonChild);
};

const cleanup = () => {
  stopDaemon();
  if (!opts.spawnPort || opts.keep || dirKept) return;
  try {
    fs.rmSync(userData, { recursive: true, force: true });
    console.log(`[dogfood] cleaned up scene ${userData}`);
  } catch (error) {
    console.error(`[dogfood] could not remove ${userData}: ${error.message}`);
  }
};

const tokenFile = path.join(userData, 'daemon.token');
const dbFile = path.join(userData, 'iKi_v0.db');
const bootHint = `IKI_USER_DATA_PATH=${userData} IKI_DAEMON_PORT=<port> pnpm run daemon:start`;

if (opts.spawnPort) {
  console.log(`[dogfood] booting private daemon on ${opts.spawnPort}, user-data ${userData}`);
  daemonChild = spawn(
    process.execPath,
    [
      path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'),
      path.join(REPO_ROOT, 'packages', 'daemon', 'src', 'index.ts'),
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, IKI_USER_DATA_PATH: userData, IKI_DAEMON_PORT: String(opts.spawnPort) },
      stdio: ['ignore', 'ignore', 'inherit'],
    }
  );
  daemonChild.on('exit', code => {
    if (code && !stoppingDaemon) {
      console.error(`[dogfood] daemon exited with ${code}`);
    }
  });
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
const request = async (method, route, { headers = {}, body } = {}) => {
  const res = await fetch(`${daemonUrl}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok || json.success === false) {
    throw new Error(`${method} ${route} → HTTP ${res.status}: ${json.error || text.slice(0, 200)}`);
  }
  return json;
};

const credentials = { token: '', clientId: '' };
const authHeaders = () => ({
  Authorization: `Bearer ${credentials.token}`,
  'X-Iki-Client': credentials.clientId,
});

const main = async () => {
  // 0. health — the daemon we were pointed at must actually be up. A spawned
  //    daemon takes seconds to run its migrations, so poll instead of racing.
  let health = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      health = await request('GET', '/v1/health');
      break;
    } catch (error) {
      if (!opts.spawnPort) throw new Error(`${daemonUrl}/v1/health: ${error.message}`);
      await sleep(500);
    }
  }
  if (!health) die(`spawned daemon never answered ${daemonUrl}/v1/health`);
  console.log(`[dogfood] daemon ok: ${daemonUrl} (port ${health.port})`);

  if (!fs.existsSync(tokenFile)) die(`no ${tokenFile}`, bootHint);
  if (!fs.existsSync(dbFile)) die(`no ${dbFile} — schema not initialized`, bootHint);

  // 1. register: the setup token lives in that dir; it rotates on each use.
  const setupToken = fs.readFileSync(tokenFile, 'utf8').trim();
  const registered = await request('POST', '/v1/clients/register', {
    headers: { 'x-iki-setup-token': setupToken },
    body: { name: 'dogfood-turn', scopes: SCOPES, allowed_tools: opts.tools },
  });
  credentials.token = registered.token;
  credentials.clientId = registered.client_id;
  console.log(
    `[dogfood] client ${registered.client_id}: scopes(${registered.scopes.join(', ')})`
  );

  // 2. seed the provider + workspace rows in the exact run_smoke shape. Safe
  //    while the daemon runs: both writers queue behind PRAGMA busy_timeout.
  const db = new DatabaseSync(dbFile, { timeout: 10_000 });
  const now = new Date().toISOString();
  try {
    db.prepare('SELECT id FROM providers LIMIT 1').get();
  } catch {
    db.close();
    die(`${dbFile} has no providers table`, bootHint);
  }
  db.prepare(
    `INSERT OR REPLACE INTO providers
       (id, name, type, api_key, models, model_options, base_url, enabled,
        created_at, updated_at, available_models, api_version, is_response_api)
     VALUES (?, ?, ?, ?, ?, '{}', ?, 1, ?, ?, '[]', NULL, 0)`
  ).run(
    PROVIDER_ID,
    'Dogfood',
    PROVIDER_TYPE,
    opts.apiKey,
    JSON.stringify([opts.model]),
    opts.baseUrl.replace(/\/+$/, ''),
    now,
    now
  );
  db.prepare(
    `INSERT OR REPLACE INTO workspaces
       (id, path, name, is_temporary, show_in_list, created_at, updated_at)
     VALUES (?, ?, ?, 0, 1, ?, ?)`
  ).run(WORKSPACE_ID, opts.workspace, 'dogfood-ws', now, now);

  // The provider factory takes the FIRST enabled row matching the type, so more
  // than one in a supposedly isolated dir means the dir is not isolated.
  const sameType = db
    .prepare('SELECT id FROM providers WHERE type = ? AND enabled = 1')
    .all(PROVIDER_TYPE)
    .map(row => row.id);
  db.close();
  if (sameType.length > 1) {
    console.warn(
      `[dogfood] WARN ${sameType.length} enabled ${PROVIDER_TYPE} providers ` +
        `(${sameType.join(', ')}) — the turn binds to the first match, which may not be ours`
    );
  }
  console.log(
    `[dogfood] seeded ${PROVIDER_ID} → ${opts.baseUrl} · ${opts.model}; ` +
      `${WORKSPACE_ID} → ${opts.workspace}`
  );

  // 3. create the thread ALREADY bound to the workspace (no raw UPDATE), then
  //    read the binding back over GET to prove the tools will see it.
  const created = await request('POST', '/v1/chat/threads', {
    headers: authHeaders(),
    body: { title: 'dogfood-turn', workspace_id: WORKSPACE_ID },
  });
  const threadId = created.thread.id;
  const readback = await request('GET', `/v1/chat/threads/${threadId}`, {
    headers: authHeaders(),
  });
  if (readback.thread.workspace_id !== WORKSPACE_ID) {
    die(
      `thread ${threadId} is not bound to ${WORKSPACE_ID} ` +
        `(GET says ${String(readback.thread.workspace_id)})`,
      'file/shell tools refuse to run on an unbound thread'
    );
  }
  console.log(`[dogfood] thread ${threadId} bound to ${WORKSPACE_ID}`);

  // 4. drive the turn.
  const summary = {
    daemon: daemonUrl,
    threadId,
    workspace: opts.workspace,
    model: opts.model,
    task: opts.task,
    approvalMode: opts.approve ? 'approve' : 'deny',
    toolsUsed: [],
    toolOutputs: 0,
    approvals: [],
    denied: 0,
    tokenUsage: null,
    terminal: null,
    intermediateResults: [],
    errors: [],
    textLength: 0,
    ok: false,
  };
  let text = '';
  // Approvals sent but not yet decided (or whose resume is still running).
  // The resumed turn streams on THIS socket, so a stream-result that arrives
  // while one is outstanding belongs to the previous segment.
  const pendingApprovals = new Set();

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    const ws = new WebSocket(wsUrl, { headers: authHeaders() });
    const timer = setTimeout(() => {
      safeClose(ws);
      finish(new Error(`turn timed out after ${opts.timeoutSec}s`));
    }, opts.timeoutSec * 1000);

    ws.on('error', error => finish(new Error(`ws ${wsUrl}: ${error.message}`)));
    ws.on('close', (code, reason) => {
      if (summary.terminal) return finish();
      finish(
        new Error(
          `socket closed before stream-result (code ${code} ${String(reason || '')})`
        )
      );
    });

    ws.on('message', raw => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      // Control frames arrive wrapped as {channel:'daemon',payload}; UI chunks
      // arrive bare. Unwrap before dispatching, and keep which side it came
      // from: a wrapped control `error` means the request never started (no
      // stream-result will follow), while a bare one is a terminal UI chunk of
      // a stream that still ends in stream-result.
      const isControlFrame = msg.channel === 'daemon' && !!msg.payload;
      if (isControlFrame) msg = msg.payload;
      const type = msg.type;

      if (type === 'ready') {
        ws.send(
          JSON.stringify({
            type: 'start',
            request_id: 'dogfood-1',
            payload: {
              providerType: PROVIDER_TYPE,
              model: opts.model,
              // The wire field is `thread_id`: the send-payload schema maps it
              // to `threadId` and drops unknown keys, so sending `threadId`
              // here silently runs the turn WITHOUT a thread (no workspace
              // scoping, and the harness dies on its todo-plan write).
              thread_id: threadId,
              tools: opts.tools,
              messages: [{ role: 'user', content: opts.task }],
            },
          })
        );
        return;
      }

      if (type === 'approve-result') {
        const id = msg.approval_id ?? msg.approvalId;
        if (typeof id === 'string') pendingApprovals.delete(id);
        const awaiting =
          msg.awaitingApproval === true ||
          (Array.isArray(msg.waitingForApprovals) && msg.waitingForApprovals.length > 0);
        if (awaiting || pendingApprovals.size > 0) return;
        // The resume ran to completion on this socket and THIS frame is its
        // terminal signal — after an approval the turn does not emit another
        // stream-result. Closing on stream-result alone truncates the turn.
        summary.terminal = {
          success: msg.success !== false,
          source: 'approve-result',
          ...(msg.error ? { error: msg.error } : {}),
        };
        safeClose(ws);
        return finish();
      }

      if (type === 'stream-result') {
        const awaiting =
          msg.awaitingApproval === true ||
          (Array.isArray(msg.waitingForApprovals) && msg.waitingForApprovals.length > 0);
        const result = {
          success: msg.success !== false,
          ...(typeof msg.awaitingApproval === 'boolean'
            ? { awaitingApproval: msg.awaitingApproval }
            : {}),
          ...(Array.isArray(msg.waitingForApprovals)
            ? { waitingForApprovals: msg.waitingForApprovals.length }
            : {}),
          ...(msg.error ? { error: msg.error } : {}),
        };
        if (awaiting || pendingApprovals.size > 0) {
          // NOT terminal: either approvals are outstanding and the resumed turn
          // keeps streaming on this same socket, or this result came back from
          // the original start() while an approval resume owns the turn now.
          // A later stream-result (nothing pending) is the real end.
          summary.intermediateResults.push(result);
          return;
        }
        summary.terminal = result;
        // The daemon keeps the socket open after a finished turn, so waiting
        // for 'close' here would hang to the deadline.
        safeClose(ws);
        return finish();
      }

      // A bare {type:'error',errorText} is a terminal UI chunk; the stream
      // still ends in stream-result. A WRAPPED control error (auth, scope,
      // thread access, start-payload failure) means nothing will stream and no
      // stream-result is coming, so stop waiting instead of hanging.
      if (type === 'error') {
        const message = String(msg.error ?? msg.errorText ?? 'unknown error');
        summary.errors.push(message);
        if (isControlFrame) {
          safeClose(ws);
          return finish(new Error(`daemon refused the turn: ${message}`));
        }
        return;
      }

      if (type === 'text-delta') {
        text += msg.delta || '';
        process.stdout.write('.');
        return;
      }

      if (type === 'tool-input-available') {
        summary.toolsUsed.push({ tool: msg.toolName, input: msg.input ?? null });
        process.stdout.write(`\n[dogfood] tool ${msg.toolName} `);
        return;
      }

      if (type === 'tool-output-available') {
        summary.toolOutputs += 1;
        return;
      }

      if (type === 'tool-output-error') {
        summary.toolOutputs += 1;
        summary.errors.push(`tool output: ${msg.errorText}`);
        return;
      }

      if (type === 'data-token-usage') {
        summary.tokenUsage = msg.data ?? null;
        return;
      }

      if (type === 'tool-approval-request') {
        const approved = opts.approve;
        if (!approved) summary.denied += 1;
        summary.approvals.push({
          approvalId: msg.approvalId,
          toolName: msg.toolName ?? null,
          decision: approved ? 'approve' : 'deny',
        });
        process.stdout.write(
          `\n[dogfood] ${approved ? 'approving' : 'DENYING'} ${String(msg.toolName)} ` +
            `${JSON.stringify(msg.input ?? {}).slice(0, 120)}`
        );
        ws.send(
          JSON.stringify({ type: 'approve-tool', approval_id: msg.approvalId, approved })
        );
        return;
      }

      if (type === 'approve-result' && msg.success === false) {
        summary.errors.push(`approve-result: ${msg.error}`);
      }
    });
  });

  summary.textLength = text.length;
  summary.ok =
    !!summary.terminal &&
    summary.terminal.success === true &&
    summary.denied === 0 &&
    summary.errors.length === 0;

  console.log('\n\n=== transcript ===');
  console.log(text || '(no assistant text)');
  console.log('\n=== summary ===');
  console.log(JSON.stringify({ ...summary, text }, null, 2));

  if (!summary.ok) {
    if (summary.denied > 0) {
      console.error(
        `[dogfood] blocked: ${summary.denied} approval(s) denied — rerun with --approve`
      );
    } else if (summary.errors.length > 0) {
      console.error(`[dogfood] errors: ${summary.errors.join(' | ')}`);
    } else {
      console.error('[dogfood] turn did not end in a successful stream-result');
    }
    keepScene('turn failed');
    // Stop the daemon we spawned even on failure: a live child handle would
    // keep this process alive forever, and the dir alone is what to inspect.
    stopDaemon();
    process.exitCode = 1;
    return;
  }
  cleanup();
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    keepScene(`interrupted (${signal})`);
    process.exit(130);
  });
}

// Any exit path that did not go through cleanup() (a die() after the spawn, an
// interrupt) must still not leave the daemon we started running: a live child
// handle keeps this process alive, and a live daemon holds the DB open.
process.on('exit', stopDaemon);

main().catch(error => {
  keepScene('fatal');
  stopDaemon();
  console.error(`[dogfood] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
