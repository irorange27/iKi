import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildSystemEvalSummary,
  parseArgs,
  parseRunMapping,
  renderPaperSystemEvalMarkdown,
} = require('../../scripts/benchmarks/summarize-desktop-pet-system-eval.cjs') as {
  buildSystemEvalSummary: (options: {
    outputDir: string;
    runs: string[];
    observationsPath?: string;
  }) => Promise<{
    runs: Array<{
      label: string;
      averageTaskDurationMs: number | null;
      firstTextDeltaAtMs: number | null;
      topLatencySource: { name: string | null } | null;
    }>;
    observationSummary: {
      available: boolean;
      closedLoopSummary: { total: number; pass: number; fail: number; partial: number };
      resourceSamples: Array<{ label: string }>;
    };
    highlights: string[];
  }>;
  parseArgs: (argv: string[]) => { outputDir: string; runs: string[]; observationsPath?: string };
  parseRunMapping: (value: string) => { label: string; dir: string };
  renderPaperSystemEvalMarkdown: (summary: unknown) => string;
};

const tempDirs: string[] = [];

const makeTempDir = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-system-eval-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe('summarize-desktop-pet-system-eval', () => {
  it('parses CLI arguments and run mappings', () => {
    const parsed = parseArgs([
      '--output-dir',
      '/tmp/out',
      '--run',
      'explicit_policy=/tmp/run-a',
      '--observations',
      '/tmp/observations.json',
    ]);

    expect(parsed).toEqual({
      outputDir: '/tmp/out',
      runs: ['explicit_policy=/tmp/run-a'],
      observationsPath: '/tmp/observations.json',
    });

    expect(parseRunMapping('tone_only=/tmp/run-b')).toEqual({
      label: 'tone_only',
      dir: '/tmp/run-b',
    });
  });

  it('builds a combined summary from benchmark runs and manual observations', async () => {
    const rootDir = await makeTempDir();
    const runDir = path.join(rootDir, 'explicit-policy');
    const daemonDir = path.join(runDir, 'daemon');
    await fs.mkdir(daemonDir, { recursive: true });

    await fs.writeFile(
      path.join(runDir, 'run-summary.json'),
      `${JSON.stringify(
        {
          providerType: 'deepseek',
          model: 'deepseek-chat',
          affectMode: 'explicit_policy',
          contextMode: 'benchmark_clean',
          totalCases: 52,
          parsedPredictions: 52,
          parseFailures: 0,
          overall: [
            {
              coverage_rate: 1,
              policy_composite_error_rate: 0.25,
            },
          ],
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    await fs.writeFile(
      path.join(daemonDir, 'latency-summary.json'),
      `${JSON.stringify(
        {
          averageTaskDurationMs: 15191.775,
          topSources: [
            {
              name: 'modelBeforeFirstToolMs',
              shareOfProfiledTaskTime: 0.33,
              avgDurationMs: 5006.079,
            },
          ],
          averages: {
            firstTextDeltaAtMs: 947.363,
            threadCreateMs: 8.224,
            streamHandshakeMs: 4.887,
            toolExecutionMs: 0,
          },
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    const observationsPath = path.join(rootDir, 'observations.json');
    await fs.writeFile(
      observationsPath,
      `${JSON.stringify(
        {
          version: 1,
          environment: {
            machine: 'MacBook Pro',
            os: 'macOS 15',
            build: 'local dev build',
            displayScale: 'default',
            notes: 'quiet background load',
          },
          resourceSamples: [
            {
              profileId: 'idle_companion_visible',
              label: '空闲伴随显示',
              source: 'Activity Monitor',
              sampleCount: 3,
              windowSeconds: 60,
              cpuPercentAvg: 2.4,
              cpuPercentPeak: 4.9,
              rssMbAvg: 182.2,
              rssMbPeak: 196.5,
            },
          ],
          closedLoopChecks: [
            {
              scenarioId: 'chat_streaming_thinking',
              label: '对话流式生成 -> thinking',
              expectedCompanionPhase: 'thinking',
              status: 'pass',
              observedCompanionPhase: 'thinking',
              observedLatencyMs: 320,
            },
            {
              scenarioId: 'ready_request_execute',
              label: '准备充分请求 -> execute',
              expectedCompanionPhase: 'execute',
              status: 'fail',
              observedCompanionPhase: 'idle',
              observedLatencyMs: 910,
              notes: 'phase regressed during manual pass',
            },
          ],
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    const summary = await buildSystemEvalSummary({
      outputDir: path.join(rootDir, 'out'),
      runs: [`explicit_policy=${runDir}`],
      observationsPath,
    });

    expect(summary.runs).toHaveLength(1);
    expect(summary.runs[0]).toMatchObject({
      label: 'explicit_policy',
      averageTaskDurationMs: 15191.775,
      firstTextDeltaAtMs: 947.363,
      topLatencySource: {
        name: 'modelBeforeFirstToolMs',
      },
    });

    expect(summary.observationSummary.available).toBe(true);
    expect(summary.observationSummary.closedLoopSummary).toMatchObject({
      total: 2,
      pass: 1,
      fail: 1,
      partial: 0,
    });
    expect(summary.observationSummary.resourceSamples[0]).toMatchObject({
      label: '空闲伴随显示',
    });

    const markdown = renderPaperSystemEvalMarkdown(summary);
    expect(markdown).toContain('# 论文正文草稿：系统层评估');
    expect(markdown).toContain('对话流式生成 -> thinking');
    expect(markdown).toContain('modelBeforeFirstToolMs');
    expect(markdown).toContain('空闲伴随显示');
    expect(summary.highlights.some(item => item.includes('功能闭环核查共记录 2 个场景'))).toBe(true);
  });
});
