import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createSimpleAgentRunner } from '@iki/backend/agent/runners/simple_agent_runner';
import { defaultToolRegistry } from '@iki/backend/tools';
import { runWithToolRuntimeContext } from '@iki/backend/tools/runtime_context';

import { gradeScenarioOutcome } from './graders';
import type { EvalScenario, ScenarioOutcome } from './types';

export type LiveRunContext = {
  providerType: string;
  providerId?: string;
  model: string;
  /** Absolute path of the scenario workspace (tools resolve inside it). */
  workspaceRoot: string;
  threadId: string;
};

const EVAL_SYSTEM_PROMPT =
  'You are a file-editing assistant working inside a workspace directory. ' +
  'Complete the task using your tools, then reply with a one-sentence confirmation of what changed.';

/**
 * Runs one scenario against a REAL model in a REAL workspace: seed files,
 * let the agent work with actual tools, then grade the deterministic task
 * outcomes (files on disk, tool usage). The model is never scripted —
 * otherwise nothing about the harness under test is being measured.
 */
export const runScenarioLive = async (params: {
  scenario: EvalScenario;
  ctx: LiveRunContext;
}): Promise<ScenarioOutcome> => {
  const started = Date.now();
  const { scenario, ctx } = params;

  for (const [rel, content] of Object.entries(scenario.files ?? {})) {
    const abs = path.join(ctx.workspaceRoot, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }

  const tools = scenario.tools
    .map(name => defaultToolRegistry.get(name))
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool));

  const maxIterations = scenario.maxIterations ?? 6;
  const runner = createSimpleAgentRunner({
    enabled: true,
    providerType: ctx.providerType,
    providerId: ctx.providerId,
    model: ctx.model,
    systemPrompt: EVAL_SYSTEM_PROMPT,
    enableTools: tools.length > 0,
    maxIterations,
    maxTokens: 500,
  });

  const toolsUsed = new Set<string>();
  let response = '';
  let iterations = 0;
  let modelError: string | undefined;

  const gen = runner.run({
    prompt: scenario.prompt,
    tools,
    providerType: ctx.providerType,
    providerId: ctx.providerId,
    model: ctx.model,
    config: {
      enabled: true,
      enableTools: tools.length > 0,
      providerType: ctx.providerType,
      model: ctx.model,
      maxTokens: 500,
      temperature: 0,
      maxIterations,
      systemPrompt: EVAL_SYSTEM_PROMPT,
    },
    maxIterations,
  });

  await runWithToolRuntimeContext({ threadId: ctx.threadId }, async () => {
    try {
      for await (const step of gen) {
        if (step.type === 'tool_execution_start') {
          toolsUsed.add(step.toolName);
        }
      }
      const final = await gen.next();
      response = final.value?.response ?? '';
      iterations = final.value?.iterations ?? 0;
    } catch (error) {
      // A model/provider failure is a graded outcome (score 0), not a
      // crashed eval — the report must always be produced.
      modelError = error instanceof Error ? error.message : String(error);
    }
  });

  // Read back every path the grader might look at.
  const expectationPaths = Object.keys(scenario.expect.files ?? {});
  const seedPaths = Object.keys(scenario.files ?? {});
  const files: Record<string, string> = {};
  for (const rel of [...new Set([...expectationPaths, ...seedPaths])]) {
    try {
      files[rel] = await fs.readFile(path.join(ctx.workspaceRoot, rel), 'utf8');
    } catch {
      // absent on purpose — graders treat a missing key as "file missing"
    }
  }

  const grade = gradeScenarioOutcome({
    expect: scenario.expect,
    response,
    files,
    toolsUsed: [...toolsUsed],
  });
  if (modelError) {
    grade.failures.unshift(`model error: ${modelError}`);
    grade.passed = false;
  }

  return {
    scenarioId: scenario.id,
    response,
    toolsUsed: [...toolsUsed],
    iterations,
    durationMs: Date.now() - started,
    ...grade,
  };
};
