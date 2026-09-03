// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const { getVisibleWorkspacesMock, getWorkspaceMock, getChatThreadMock } = vi.hoisted(() => ({
  getVisibleWorkspacesMock: vi.fn(),
  getWorkspaceMock: vi.fn(),
  getChatThreadMock: vi.fn(),
}));

vi.mock('@iki/backend/db/workspaces', () => ({
  getVisibleWorkspaces: getVisibleWorkspacesMock,
  getWorkspace: getWorkspaceMock,
  getWorkspaceByPath: vi.fn(),
  addWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
}));

vi.mock('@iki/backend/db/chat_thread', () => ({
  getChatThread: getChatThreadMock,
  updateChatThread: vi.fn(),
}));

import type { EvalScenario } from '@iki/backend/evals/types';
import { runScenarioLive } from '@iki/backend/evals/live_runner';
import { registerStandardTools } from '@iki/backend/tools';
import { getIntegrationTestContext, hasProviderConfig } from './setup';

registerStandardTools();

// Live-model evals cost money and are non-deterministic: they only run when
// explicitly requested (`pnpm run eval:live`) AND a provider is configured.
const skip = !hasProviderConfig() || !process.env.IKI_RUN_LIVE_EVALS;

const SCENARIOS: EvalScenario[] = [
  {
    id: 'fix-json-config-port',
    prompt:
      'In config.json, change the port value to 8080. Keep the file valid JSON and do not change anything else.',
    files: {
      'config.json': '{\n  "name": "demo",\n  "port": 3000,\n  "debug": false\n}\n',
    },
    tools: ['read_file', 'edit', 'write_file', 'shell'],
    maxIterations: 6,
    expect: {
      files: {
        'config.json': {
          contains: ['"port": 8080'],
        },
      },
    },
  },
  {
    id: 'append-bullet-to-notes',
    prompt:
      "Append a new bullet line '- reviewed by agent' as the last line of notes.md, then confirm how many bullet lines the file has now.",
    files: {
      'notes.md': '- first\n- second\n- third\n',
    },
    tools: ['read_file', 'edit', 'write_file', 'shell'],
    maxIterations: 6,
    expect: {
      files: {
        'notes.md': {
          contains: ['- first', '- reviewed by agent'],
        },
      },
    },
  },
  {
    id: 'create-report-file',
    prompt: "Create a file named report.md whose entire content is exactly one line: eval ok",
    tools: ['write_file', 'shell'],
    maxIterations: 4,
    expect: {
      files: {
        'report.md': {
          equals: 'eval ok',
        },
      },
    },
  },
];

const outcomes: Array<{ scenarioId: string; passed: boolean; failures: string[]; durationMs: number }> = [];
let workspaceRoot = '';
let threadSeq = 0;

afterAll(async () => {
  if (outcomes.length === 0) return;
  const ctx = getIntegrationTestContext();
  await fs.mkdir('eval-results', { recursive: true });
  await fs.writeFile(
    path.join('eval-results', 'last-live-run.json'),
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        providerType: ctx?.providerType ?? 'unknown',
        model: ctx?.model ?? 'unknown',
        scenarios: outcomes,
        passed: outcomes.filter(o => o.passed).length,
        total: outcomes.length,
      },
      null,
      2
    )
  );
});

describe.skipIf(skip)('agent evals (live model, deterministic graders)', () => {
  const ctx = getIntegrationTestContext()!;

  for (const scenario of SCENARIOS) {
    it(scenario.id, async () => {
      workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), `iki-eval-${scenario.id}-`));
      getVisibleWorkspacesMock.mockReturnValue([
        {
          id: 'workspace_eval',
          path: workspaceRoot,
          name: 'eval-workspace',
          is_temporary: 0,
          show_in_list: 1,
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
        },
      ]);
      const workspaceRecord = {
        id: 'workspace_eval',
        path: workspaceRoot,
        name: 'eval-workspace',
        is_temporary: 0,
        show_in_list: 1,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      };
      getVisibleWorkspacesMock.mockReturnValue([workspaceRecord]);
      getWorkspaceMock.mockReturnValue(workspaceRecord);
      getChatThreadMock.mockReturnValue({ id: `thread_eval_${++threadSeq}`, workspace_id: 'workspace_eval' });

      const outcome = await runScenarioLive({
        scenario,
        ctx: {
          providerType: ctx.providerType,
          providerId: ctx.providerId,
          model: ctx.model,
          workspaceRoot,
          threadId: `thread_eval_${threadSeq}`,
        },
      });
      outcomes.push({
        scenarioId: outcome.scenarioId,
        passed: outcome.passed,
        failures: outcome.failures,
        durationMs: outcome.durationMs,
      });

      expect(outcome.passed, outcome.failures.join('\n')).toBe(true);
    });
  }
});
