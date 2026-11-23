// Keyless CLI e2e test: spawns `packages/cli/src/main.ts` against the local
// faux OpenAI server and verifies:
//   1. Multi-step tool execution without approval friction (`write_file` x2)
//   2. SessionEvent JSONL persistence & multi-turn history replay (`CHECK_HISTORY`)
//   3. Token & cache-read usage reporting in `--json` output
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'smol-toml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FAUX_PORT = Number(process.env.IKI_CLI_E2E_FAUX_PORT || 18739);
const TSX_BIN = path.join(ROOT, 'node_modules/.bin/tsx');
const CLI_ENTRY = path.join(ROOT, 'packages/cli/src/main.ts');
const FAUX_SERVER = path.join(ROOT, 'tests/integration/e2e/faux_openai_server.mjs');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-cli-e2e-'));
const dataDir = path.join(workDir, 'data');
const workspaceDir = path.join(workDir, 'workspace');
const storeDir = dataDir;
const fauxLog = path.join(workDir, 'faux.log');
fs.mkdirSync(storeDir, { recursive: true });
fs.mkdirSync(workspaceDir, { recursive: true });

fs.mkdirSync(path.join(storeDir, 'skills', 'demo-skill'), { recursive: true });
fs.writeFileSync(
  path.join(storeDir, 'skills', 'demo-skill', 'SKILL.md'),
  '---\nname: demo-skill\ndescription: Demo skill for CLI E2E verification\n---\nAlways greet concisely.\n'
);
fs.writeFileSync(
  path.join(storeDir, 'settings.toml'),
  '[general]\nlanguage = "en"\n'
);

fs.writeFileSync(
  path.join(storeDir, 'models.toml'),
  stringify({
    providers: {
      faux_cli: {
        type: 'openai-compatible',
        name: 'Faux CLI OpenAI',
        apiKey: 'sk-faux-cli',
        baseUrl: `http://127.0.0.1:${FAUX_PORT}/v1`,
        models: ['faux-e2e-model'],
        availableModels: ['faux-e2e-model'],
        modelOptions: {},
        enabled: true,
      },
    },
  })
);

const faux = spawn(process.execPath, [FAUX_SERVER], {
  env: { ...process.env, FAUX_PORT: String(FAUX_PORT), FAUX_LOG: fauxLog },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const cleanup = () => {
  try {
    faux.kill('SIGKILL');
  } catch {}
  fs.rmSync(workDir, { recursive: true, force: true });
};
process.on('exit', cleanup);

const waitForServer = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${FAUX_PORT}/v1/models`);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('faux openai server failed to start');
};

const runCli = args => {
  const out = execFileSync(TSX_BIN, [CLI_ENTRY, '--data-dir', dataDir, '--workspace', workspaceDir, '--json', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HOME: workDir },
  });
  return JSON.parse(out);
};

try {
  await waitForServer();

const SHELL_TOOL = process.platform === 'win32' ? 'pwsh' : 'bash';

  // Turn 1: E2E_TASK triggers two shell calls and returns E2E_DONE
  const turn1 = runCli(['--thread', 'cli-e2e-1', '--tools', `${SHELL_TOOL},job`, '--skills', 'user:demo-skill', 'E2E_TASK run']);
  assert.equal(turn1.success, true, 'turn 1 should succeed');
  assert.ok(turn1.text.includes('E2E_DONE'), `unexpected turn 1 text: ${turn1.text}`);
  assert.ok(turn1.usage && turn1.usage.inputTokens > 0, 'turn 1 should report inputTokens');
  assert.ok(turn1.usage.cacheReadTokens > 0, 'turn 1 should report cacheReadTokens');
  assert.ok(
    fs.existsSync(path.join(storeDir, 'state', 'chat_threads.json')),
    'state/chat_threads.json should live under state/'
  );

  assert.equal(
    fs.readFileSync(path.join(workspaceDir, 'e2e/hello.txt'), 'utf8'),
    'e2e-written-by-agent'
  );
  assert.equal(
    fs.readFileSync(path.join(workspaceDir, 'e2e/second.txt'), 'utf8'),
    'e2e-second-approval'
  );

  // Verify SessionEvent JSONL was persisted
  const sessionFile = path.join(storeDir, 'sessions', 'cli-e2e-1.jsonl');
  assert.ok(fs.existsSync(sessionFile), 'session JSONL file should exist');
  const lines = fs.readFileSync(sessionFile, 'utf8').trim().split('\n');
  assert.ok(lines.length >= 2, 'session JSONL should contain header and event batches');

  // Turn 2: CHECK_HISTORY verifies persisted history is replayed on the next CLI invocation
  const turn2 = runCli(['--thread', 'cli-e2e-1', '--tools', `${SHELL_TOOL},job`, 'CHECK_HISTORY']);
  assert.equal(turn2.success, true, 'turn 2 should succeed');
  assert.ok(
    turn2.text.includes('HISTORY_REPORT') && turn2.text.includes('tool_msgs=2'),
    `expected HISTORY_REPORT with tool_msgs=2, got: ${turn2.text}`
  );

  // Verify KV-cache prefix stability on the wire:
  // Turn 2's messages[0..N-1] must match Turn 1's final step byte-for-byte,
  // followed by Turn 1's closing assistant reply and Turn 2's user prompt,
  // with consistent session affinity header.
  const fauxEntries = fs
    .readFileSync(fauxLog, 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
    .filter(entry => Array.isArray(entry.messages));
  const turn1FinalReq = [...fauxEntries]
    .reverse()
    .find(entry => entry.lastUserText === 'E2E_TASK run' && entry.toolMsgs === 2);
  const turn2Req = fauxEntries.find(entry => entry.lastUserText === 'CHECK_HISTORY');
  assert.ok(turn1FinalReq && turn2Req, 'expected both turn 1 final step and turn 2 wire requests in fauxLog');
  assert.equal(turn1FinalReq.sessionAffinity, 'cli-e2e-1', 'turn 1 must send session affinity header');
  assert.equal(turn2Req.sessionAffinity, 'cli-e2e-1', 'turn 2 must send matching session affinity header');
  assert.deepEqual(
    turn2Req.messages.slice(0, turn1FinalReq.messages.length),
    turn1FinalReq.messages,
    'turn 2 wire prefix must match turn 1 final step byte-for-byte for KV cache hit'
  );
  assert.equal(
    turn2Req.messages[turn1FinalReq.messages.length]?.role,
    'assistant',
    'turn 1 final assistant answer must follow tool results before turn 2 user message'
  );

  // Interactive REPL mode (-i -c): resumes latest thread, handles slash commands + chat turn + /exit
  const interactiveOut = execFileSync(
    TSX_BIN,
    [CLI_ENTRY, '--interactive', '--continue', '--data-dir', dataDir, '--workspace', workspaceDir, '--tools', `${SHELL_TOOL},job`],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, HOME: workDir, NO_COLOR: '1' },
      input: ['/help', '/models', '/context', '/jobs', '/threads', 'CHECK_HISTORY', '/compact', '/history', '/usage', '/exit', ''].join('\n'),
    }
  );
  assert.ok(interactiveOut.includes('iKi CLI'), 'interactive banner should render');
  assert.ok(interactiveOut.includes('cli-e2e-1'), '--continue should resume cli-e2e-1');
  assert.ok(interactiveOut.includes('Commands:'), '/help should print command list');
  assert.ok(interactiveOut.includes('Enabled models:'), '/models should list models');
  assert.ok(interactiveOut.includes('Loaded Context & Harness State:'), '/context should show repo context & harness state');
  assert.ok(interactiveOut.includes('Durable background jobs'), '/jobs should list recorded durable shell jobs');
  assert.ok(interactiveOut.includes('HISTORY_REPORT'), 'interactive chat turn should stream model reply');
  assert.ok(interactiveOut.includes('Compacted thread cli-e2e-1:'), '/compact should persist a compaction checkpoint');
  assert.ok(interactiveOut.includes('Session usage: 1 turn(s)'), '/usage should aggregate session turns');

  console.log('[cli-e2e] PASS — CLI interactive REPL, tool execution, JSONL persistence, history replay, and cache usage verified');
} finally {
  cleanup();
}
