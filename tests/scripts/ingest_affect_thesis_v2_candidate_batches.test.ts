import { describe, expect, it } from 'vitest';

describe('ingest-affect-thesis-v2-candidate-batches', () => {
  it('parses manifest, repeated input, and output overrides', async () => {
    const script = await import(
      '../../scripts/benchmarks/ingest-affect-thesis-v2-candidate-batches.cjs'
    );
    const parsed = script.parseArgs([
      '--manifest',
      'tmp/manifest.jsonl',
      '--input',
      'tmp/a.jsonl,tmp/b.json',
      '--input',
      'tmp/c.json',
      '--output-dir',
      'tmp/out',
    ]);

    expect(parsed).toEqual(
      expect.objectContaining({
        manifestPath: 'tmp/manifest.jsonl',
        inputPaths: ['tmp/a.jsonl', 'tmp/b.json', 'tmp/c.json'],
        outputDir: 'tmp/out',
      })
    );
  });

  it('flattens candidate batches into a pooled candidate list', async () => {
    const script = await import(
      '../../scripts/benchmarks/ingest-affect-thesis-v2-candidate-batches.cjs'
    );
    const result = script.flattenCandidateBatches({
      manifestRows: [
        {
          sample_id: 'sample_1',
          case_id: 'thesis_main_v2_001',
          split: 'main_affect',
          generation_template_id: 'main_affect_candidate_writer_v1',
        },
      ],
      batchRowsByInput: [
        {
          inputPath: 'tmp/deepseek-round1.json',
          rows: [
            {
              sample_id: 'sample_1',
              batch_id: 'deepseek_round1',
              packet_id: 'packet_sample_1',
              source_type: 'llm',
              source_model: 'deepseek-chat',
              candidates: [
                {
                  history: [{ role: 'user', text: 'h1' }],
                  current_user_message: 'm1',
                  task_context: {
                    goal: 'goal',
                    deliverable: 'deliverable',
                    constraints: ['c1'],
                  },
                  author_notes: 'note',
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.candidateRows).toEqual([
      expect.objectContaining({
        candidate_id: 'sample_1__deepseek_round1__01',
        sample_id: 'sample_1',
        case_id: 'thesis_main_v2_001',
        split: 'main_affect',
        source_type: 'llm',
        source_model: 'deepseek-chat',
      }),
    ]);
    expect(result.summary).toEqual(
      expect.objectContaining({
        total_batches: 1,
        total_candidates: 1,
        generated_candidate_id_count: 1,
      })
    );
  });
});
