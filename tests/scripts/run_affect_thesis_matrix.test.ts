import { describe, expect, it } from 'vitest';

describe('run-affect-thesis-matrix', () => {
  it('parses thesis matrix CLI arguments and keeps explicit mode order', async () => {
    const script = await import('../../scripts/benchmarks/run-affect-thesis-matrix.cjs');
    const parsed = script.parseArgs([
      '--main-cases',
      'research/main.cases.jsonl',
      '--main-gold',
      'research/main.gold.jsonl',
      '--neutral-cases',
      'research/neutral.cases.jsonl',
      '--neutral-gold',
      'research/neutral.gold.jsonl',
      '--output-dir',
      'benchmark-runs/affect-thesis-v1',
      '--provider',
      'DeepSeek',
      '--model',
      'deepseek-chat',
      '--modes',
      'tone_only,explicit_policy,no_affect,tone_only',
      '--spawn-daemon',
      '--profile-latency',
    ]);

    expect(parsed).toEqual(
      expect.objectContaining({
        mainCasesPath: 'research/main.cases.jsonl',
        mainGoldPath: 'research/main.gold.jsonl',
        neutralCasesPath: 'research/neutral.cases.jsonl',
        neutralGoldPath: 'research/neutral.gold.jsonl',
        outputDir: 'benchmark-runs/affect-thesis-v1',
        providerType: 'deepseek',
        model: 'deepseek-chat',
        modes: ['tone_only', 'explicit_policy', 'no_affect'],
        spawnDaemon: true,
        profileLatency: true,
      })
    );
  });

  it('builds one stable output directory per mode', async () => {
    const script = await import('../../scripts/benchmarks/run-affect-thesis-matrix.cjs');
    const plan = script.buildModeRunPlan({
      outputDir: 'benchmark-runs/affect-thesis-v1',
      providerType: 'deepseek',
      model: 'deepseek-chat',
      modes: ['no_affect', 'tone_only', 'explicit_policy'],
    });

    expect(plan).toEqual([
      expect.objectContaining({
        mode: 'no_affect',
        outputDir: expect.stringContaining('deepseek-deepseek-chat-no_affect'),
      }),
      expect.objectContaining({
        mode: 'tone_only',
        outputDir: expect.stringContaining('deepseek-deepseek-chat-tone_only'),
      }),
      expect.objectContaining({
        mode: 'explicit_policy',
        outputDir: expect.stringContaining('deepseek-deepseek-chat-explicit_policy'),
      }),
    ]);
  });
});
