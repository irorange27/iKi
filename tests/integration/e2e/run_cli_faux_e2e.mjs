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

  // Turn 1: E2E_TASK triggers two write_file calls and returns E2E_DONE
  const turn1 = runCli(['--thread', 'cli-e2e-1', '--tools', 'write_file,load_skill', '--skills', 'user:demo-skill', 'E2E_TASK run']);
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
  const turn2 = runCli(['--thread', 'cli-e2e-1', '--tools', 'write_file', 'CHECK_HISTORY']);
  assert.equal(turn2.success, true, 'turn 2 should succeed');
  assert.ok(
    turn2.text.includes('HISTORY_REPORT') && turn2.text.includes('tool_msgs=2'),
    `expected HISTORY_REPORT with tool_msgs=2, got: ${turn2.text}`
  );

  console.log('[cli-e2e] PASS — CLI tool execution, JSONL persistence, history replay, and cache usage verified');
} finally {
  cleanup();
}
