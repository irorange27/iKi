import { describe, expect, it } from 'vitest';

describe('audit-affect-thesis-v2-candidates', () => {
  it('parses required candidates argument', async () => {
    const script = await import('../../scripts/benchmarks/audit-affect-thesis-v2-candidates.cjs');
    const parsed = script.parseArgs([
      '--manifest',
      'tmp/manifest.jsonl',
      '--candidates',
      'tmp/candidates.jsonl',
      '--output-dir',
      'tmp/audit',
    ]);

    expect(parsed).toEqual(
      expect.objectContaining({
        manifestPath: 'tmp/manifest.jsonl',
        candidatesPath: 'tmp/candidates.jsonl',
        outputDir: 'tmp/audit',
      })
    );
  });

  it('flags banlist hits and duplicate signatures', async () => {
    const script = await import('../../scripts/benchmarks/audit-affect-thesis-v2-candidates.cjs');
    const manifestRows = [
      {
        sample_id: 'sample_1',
        cue_banlist: ['先帮我把第一步缩小'],
      },
    ];
    const candidateRows = [
      {
        candidate_id: 'cand_1',
        sample_id: 'sample_1',
        history: [{ role: 'user', text: '我知道该做什么。' }],
        current_user_message: '先帮我把第一步缩小。',
        task_context: {
          goal: 'goal',
          deliverable: 'deliverable',
          constraints: ['c1'],
        },
      },
      {
        candidate_id: 'cand_2',
        sample_id: 'sample_1',
        history: [{ role: 'user', text: '我知道该做什么。' }],
        current_user_message: '先帮我把第一步缩小。',
        task_context: {
          goal: 'goal',
          deliverable: 'deliverable',
          constraints: ['c1'],
        },
      },
    ];

    const auditRows = script.auditCandidates({ manifestRows, candidateRows });

    expect(auditRows).toHaveLength(2);
    expect(auditRows[0].status).toBe('fail');
    expect(auditRows[0].issues.map((issue: { code: string }) => issue.code)).toEqual(
      expect.arrayContaining(['manifest_banlist_hit', 'leakage_micro_step_directive'])
    );
    expect(auditRows[1].issues.map((issue: { code: string }) => issue.code)).toContain(
      'duplicate_signature'
    );
  });
});
