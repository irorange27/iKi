// Real-API CLI E2E test: runs `packages/cli/src/main.ts` against a live LLM
// endpoint (default: local gateway on port 3425 using `workbuddy/hy4flash-free`).
// Self-skips cleanly if the endpoint is unreachable.
//
// Env overrides:
//   IKI_LIVE_BASE_URL   (default: http://127.0.0.1:3425/v1)
//   IKI_LIVE_MODEL      (default: workbuddy/hy4flash-free)
//   IKI_LIVE_PROVIDER   (default: openai-compatible)
//   IKI_LIVE_API_KEY    (default: local-gateway)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'smol-toml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BASE_URL = process.env.IKI_LIVE_BASE_URL || 'http://127.0.0.1:3425/v1';
const MODEL = process.env.IKI_LIVE_MODEL || 'workbuddy/hy4flash-free';
const PROVIDER_TYPE = process.env.IKI_LIVE_PROVIDER || 'openai-compatible';
const API_KEY = process.env.IKI_LIVE_API_KEY || 'local-gateway';
const TSX_BIN = path.join(ROOT, 'node_modules/.bin/tsx');
const CLI_ENTRY = path.join(ROOT, 'packages/cli/src/main.ts');

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
  console.log(`[live-e2e] SKIP — live endpoint unreachable at ${BASE_URL}`);
  process.exit(0);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-live-e2e-'));
const dataDir = path.join(workDir, 'data');
const workspaceDir = path.join(workDir, 'workspace');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(workspaceDir, { recursive: true });

fs.writeFileSync(
  path.join(dataDir, 'models.toml'),
  stringify({
    providers: {
      live_gateway: {
        type: PROVIDER_TYPE,
        name: 'Live Gateway',
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

const runCli = args => {
  const out = execFileSync(
    TSX_BIN,
    [CLI_ENTRY, '--data-dir', dataDir, '--workspace', workspaceDir, '--json', ...args],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, HOME: workDir },
    }
  );
  return JSON.parse(out);
};

const SHELL_TOOL = process.platform === 'win32' ? 'pwsh' : 'bash';

try {
  // Turn 1: real model must invoke bash/pwsh to create live-check.txt
  const turn1 = runCli([
    '--thread',
    'live-e2e-1',
    '--tools',
    `${SHELL_TOOL},job`,
    `Use the ${SHELL_TOOL} tool to write a file named "live-check.txt" in the current working directory containing the exact text "hello-live-iki" (without trailing extra words).`,
  ]);
  assert.equal(turn1.success, true, `turn 1 failed: ${turn1.error ?? 'unknown error'}`);
  assert.ok(turn1.usage && turn1.usage.inputTokens > 0, 'turn 1 should report real inputTokens');

  const written = fs.readFileSync(path.join(workspaceDir, 'live-check.txt'), 'utf8');
  assert.ok(
    written.includes('hello-live-iki'),
    `expected live-check.txt to contain hello-live-iki, got: ${written}`
  );

  // Verify SessionEvent JSONL was persisted
  const sessionFile = path.join(dataDir, 'sessions', 'live-e2e-1.jsonl');
  assert.ok(fs.existsSync(sessionFile), 'session JSONL file should exist');

  // Turn 2: real model must recall what it wrote from replayed SessionEvent history
  const turn2 = runCli([
    '--thread',
    'live-e2e-1',
    '--tools',
    `${SHELL_TOOL},job`,
    'What exact text did you just write to live-check.txt? Reply with that text.',
  ]);
  assert.equal(turn2.success, true, `turn 2 failed: ${turn2.error ?? 'unknown error'}`);
  assert.ok(
    turn2.text.includes('hello-live-iki'),
    `expected turn 2 to recall hello-live-iki from history, got: ${turn2.text}`
  );

  console.log(
    `[live-e2e] PASS (${MODEL}) — real tool call, JSONL persistence, multi-turn recall, and usage verified ` +
      `(turn1 in=${turn1.usage.inputTokens} cacheRead=${turn1.usage.cacheReadTokens ?? 0}, ` +
      `turn2 in=${turn2.usage?.inputTokens ?? 0} cacheRead=${turn2.usage?.cacheReadTokens ?? 0})`
  );
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
