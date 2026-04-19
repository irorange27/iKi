import { describe, expect, it } from 'vitest';

describe('run-affect-daemon-benchmark', () => {
  it('parses latency profiling CLI arguments', async () => {
    const script = await import('../../scripts/benchmarks/run-affect-daemon-benchmark.cjs');
    const parsed = script.parseArgs([
      '--cases',
      'cases.jsonl',
      '--gold',
      'gold.jsonl',
      '--output-dir',
      'out',
      '--provider',
      'openai',
      '--model',
      'gpt-4.1-mini',
      '--profile-latency',
      '--await-realtime-affect',
    ]);

    expect(parsed).toEqual(
      expect.objectContaining({
        casesPaths: ['cases.jsonl'],
        goldPaths: ['gold.jsonl'],
        outputDir: 'out',
        providerType: 'openai',
        model: 'gpt-4.1-mini',
        affectMode: 'explicit_policy',
        contextMode: 'benchmark_clean',
        profileLatency: true,
        awaitRealtimeAffect: true,
      })
    );
  });

  it('builds daemon tasks that replay history and use runtime policy conditions', async () => {
    const script = await import('../../scripts/benchmarks/run-affect-daemon-benchmark.cjs');
    const tasks = script.buildDaemonTasks(
      [
        {
          case_id: 'case_1',
          base_task_id: 'task_1',
          variant_id: 'blocked',
          slice: 'main',
          history: [
            { role: 'user', text: '我有点卡住了。' },
            { role: 'assistant', text: '你现在更需要我先帮你理清，还是直接帮你写？' },
          ],
          current_user_message: '先别直接替我写，我还没想清楚。',
          task_context: {
            goal: '回复经理',
            deliverable: '一条消息',
            constraints: ['不要替用户擅自决定'],
          },
        },
      ],
      {
        affectMode: 'tone_only',
        contextMode: 'benchmark_clean',
        awaitRealtimeAffect: true,
      }
    );

    expect(tasks).toEqual([
      expect.objectContaining({
        id: 'case_1',
        setupMessages: [
          { role: 'user', content: '我有点卡住了。', awaitEmotionAnalysis: true },
          { role: 'assistant', content: '你现在更需要我先帮你理清，还是直接帮你写？' },
          { role: 'user', content: '先别直接替我写，我还没想清楚。', awaitEmotionAnalysis: true },
        ],
        experimental_context: {
          affectMode: 'tone_only',
          contextMode: 'benchmark_clean',
          awaitRealtimeAffect: true,
        },
      }),
    ]);
    expect(tasks[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('Benchmark task context'),
        }),
        expect.objectContaining({
          role: 'user',
          content: '先别直接替我写，我还没想清楚。',
        }),
      ])
    );
  });
});
