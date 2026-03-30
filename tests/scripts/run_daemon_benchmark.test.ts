import { afterEach, describe, expect, it, vi } from 'vitest';

type FetchResponseLike = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

const xorEncryptToBase64 = (plainText: string, key: Buffer): string => {
  const input = Buffer.from(plainText, 'utf8');
  const output = Buffer.alloc(input.length);
  for (let index = 0; index < input.length; index += 1) {
    output[index] = input[index] ^ key[index];
  }
  return output.toString('base64');
};

describe('run-daemon-benchmark', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parses CSV rows with quoted commas and newlines', async () => {
    const script = await import('../../scripts/benchmarks/run-daemon-benchmark.cjs');
    const rows = script.parseCsvRecords(
      ['id,problem,answer,canary', '1,"hello, world","line 1', 'line 2",seed'].join('\n')
    );

    expect(rows).toEqual([
      {
        id: '1',
        problem: 'hello, world',
        answer: 'line 1\nline 2',
        canary: 'seed',
      },
    ]);
  });

  it('normalizes provider arguments to lowercase', async () => {
    const script = await import('../../scripts/benchmarks/run-daemon-benchmark.cjs');
    const parsed = script.parseArgs([
      '--benchmark',
      'browsecomp',
      '--provider',
      'DeepSeek',
      '--model',
      'deepseek-reasoner',
      '--judge-provider',
      'OpenAI',
    ]);

    expect(parsed.providerType).toBe('deepseek');
    expect(parsed.judgeProviderType).toBe('openai');
    expect(parsed.parallel).toBe(1);
  });

  it('accepts bounded task parallelism from the CLI', async () => {
    const script = await import('../../scripts/benchmarks/run-daemon-benchmark.cjs');
    const parsed = script.parseArgs([
      '--benchmark',
      'browsecomp',
      '--provider',
      'openai',
      '--model',
      'gpt-4.1-mini',
      '--parallel',
      '4',
    ]);

    expect(parsed.parallel).toBe(4);
  });

  it('accepts an explicit tool-iteration ceiling from the CLI', async () => {
    const script = await import('../../scripts/benchmarks/run-daemon-benchmark.cjs');
    const parsed = script.parseArgs([
      '--benchmark',
      'browsecomp',
      '--provider',
      'openai',
      '--model',
      'gpt-4.1-mini',
      '--max-iterations',
      '12',
    ]);

    expect(parsed.maxIterations).toBe(12);
  });

  it('decrypts BrowseComp ciphertext with the derived key', async () => {
    const script = await import('../../scripts/benchmarks/run-daemon-benchmark.cjs');
    const password = 'canary-seed';
    const decrypted = 'Final answer';
    const key = script.deriveBrowseCompKey(password, Buffer.byteLength(decrypted));
    const encrypted = xorEncryptToBase64(decrypted, key);

    expect(script.decryptBrowseCompCiphertext(encrypted, password)).toBe(decrypted);
  });

  it('extracts BrowseComp exact answer and confidence sections', async () => {
    const script = await import('../../scripts/benchmarks/run-daemon-benchmark.cjs');
    const response = [
      'Explanation: I checked the sources.',
      'Exact Answer: 42',
      'Confidence: 88%',
    ].join('\n');

    expect(script.extractBrowseCompExactAnswer(response)).toBe('42');
    expect(script.extractBrowseCompConfidence(response)).toBe('88%');
  });

  it('falls back to daemon final text when no text-delta chunks were captured', async () => {
    const script = await import('../../scripts/benchmarks/run-daemon-benchmark.cjs');

    const prediction = script.resolvePredictionText({
      chunks: [{ type: 'tool-output-available', output: { ok: true } }],
      daemonResult: {
        success: true,
        text: ['Explanation: complete', 'Exact Answer: 42', 'Confidence: 91%'].join('\n'),
      },
    });

    expect(prediction).toContain('Exact Answer: 42');
  });

  it('loads official BrowseComp rows into benchmark tasks', async () => {
    const script = await import('../../scripts/benchmarks/run-daemon-benchmark.cjs');
    const canary = 'seed';
    const question = 'Who wrote Hamlet?';
    const answer = 'William Shakespeare';
    const questionKey = script.deriveBrowseCompKey(canary, Buffer.byteLength(question));
    const answerKey = script.deriveBrowseCompKey(canary, Buffer.byteLength(answer));
    const csv = [
      'id,problem,answer,canary',
      `sample_1,"${xorEncryptToBase64(question, questionKey)}","${xorEncryptToBase64(answer, answerKey)}",${canary}`,
    ].join('\n');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => csv,
      }) satisfies FetchResponseLike)
    );

    const tasks = await script.loadTasks({
      benchmark: 'browsecomp',
      providerType: 'openai',
      model: 'gpt-4.1-mini',
      browsecompUrl: 'https://example.com/browsecomp.csv',
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        id: 'sample_1',
        expectedAnswer: answer,
        tools: ['web', 'fetch'],
        metadata: expect.objectContaining({
          benchmark: 'browsecomp',
          question,
        }),
      })
    );
    expect(tasks[0].messages).toEqual([
      {
        role: 'user',
        content: expect.stringContaining(question),
      },
    ]);
  });

  it('scores BrowseComp predictions in preview mode from extracted exact answers', async () => {
    const script = await import('../../scripts/benchmarks/run-daemon-benchmark.cjs');
    const score = await script.scorePrediction({
      benchmark: 'browsecomp',
      task: {
        expectedAnswer: '4',
        prompt: 'Question',
        metadata: {
          question: 'What is 2 + 2?',
        },
      },
      prediction: ['Explanation: arithmetic', 'Exact Answer: 4', 'Confidence: 100%'].join('\n'),
    });

    expect(score).toEqual(
      expect.objectContaining({
        type: 'browsecomp-preview',
        passed: true,
        extractedAnswer: '4',
        extractedConfidence: '100%',
      })
    );
  });

  it('runs async work with bounded concurrency and preserves result order', async () => {
    const script = await import('../../scripts/benchmarks/run-daemon-benchmark.cjs');
    const active = { current: 0, max: 0 };

    const results = await script.mapWithConcurrency({
      items: [
        { id: 'task_1', delayMs: 30 },
        { id: 'task_2', delayMs: 5 },
        { id: 'task_3', delayMs: 10 },
      ],
      parallel: 2,
      worker: async (
        item: { id: string; delayMs: number },
        index: number
      ): Promise<{ id: string; index: number }> => {
        active.current += 1;
        active.max = Math.max(active.max, active.current);
        await new Promise(resolve => setTimeout(resolve, item.delayMs));
        active.current -= 1;
        return { id: item.id, index };
      },
    });

    expect(active.max).toBeLessThanOrEqual(2);
    expect(results).toEqual([
      { id: 'task_1', index: 0 },
      { id: 'task_2', index: 1 },
      { id: 'task_3', index: 2 },
    ]);
  });
});
