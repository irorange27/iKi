import { describe, expect, it } from 'vitest';

describe('backfill-affect-thesis-v2-manifest-selections', () => {
  it('parses selection/candidate/audit arguments', async () => {
    const script = await import(
      '../../scripts/benchmarks/backfill-affect-thesis-v2-manifest-selections.cjs'
    );
    const parsed = script.parseArgs([
      '--manifest',
      'tmp/manifest.jsonl',
      '--selections',
      'tmp/selections.jsonl',
      '--candidates',
      'tmp/candidates.jsonl',
      '--audit',
      'tmp/audit.jsonl',
      '--output',
      'tmp/out.jsonl',
      '--summary',
      'tmp/summary.json',
    ]);

    expect(parsed).toEqual(
      expect.objectContaining({
        manifestPath: 'tmp/manifest.jsonl',
        selectionsPath: 'tmp/selections.jsonl',
        candidatesPath: 'tmp/candidates.jsonl',
        auditPath: 'tmp/audit.jsonl',
        outputPath: 'tmp/out.jsonl',
        summaryPath: 'tmp/summary.json',
      })
    );
  });

  it('backfills selected candidates into the manifest', async () => {
    const script = await import(
      '../../scripts/benchmarks/backfill-affect-thesis-v2-manifest-selections.cjs'
    );
    const result = script.backfillManifestSelections({
      manifestRows: [
        {
          sample_id: 'sample_1',
          draft_status: 'planned',
          candidate_status: 'pending',
          audit_status: 'pending',
          selected_candidate_id: null,
          selected_candidate_notes: null,
        },
      ],
      selectionRows: [
        {
          sample_id: 'sample_1',
          selected_candidate_id: 'cand_1',
          rejected_candidate_ids: ['cand_2'],
          selected_candidate_notes: '信息更具体，决策点更清楚。',
        },
      ],
      candidateRows: [
        { candidate_id: 'cand_1', sample_id: 'sample_1' },
        { candidate_id: 'cand_2', sample_id: 'sample_1' },
      ],
      auditRows: [
        { candidate_id: 'cand_1', status: 'pass' },
        { candidate_id: 'cand_2', status: 'pass' },
      ],
    });

    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        draft_status: 'candidate_selected',
        candidate_status: 'selected',
        audit_status: 'pass',
        selected_candidate_id: 'cand_1',
        selected_candidate_notes: '信息更具体，决策点更清楚。',
      })
    );
    expect(result.summary).toEqual(
      expect.objectContaining({
        updated_rows: 1,
        missing_selection_sample_ids: [],
      })
    );
  });

  it('rejects selections whose selected candidate did not pass audit', async () => {
    const script = await import(
      '../../scripts/benchmarks/backfill-affect-thesis-v2-manifest-selections.cjs'
    );

    expect(() =>
      script.backfillManifestSelections({
        manifestRows: [{ sample_id: 'sample_1' }],
        selectionRows: [
          {
            sample_id: 'sample_1',
            selected_candidate_id: 'cand_1',
            selected_candidate_notes: 'note',
          },
        ],
        candidateRows: [{ candidate_id: 'cand_1', sample_id: 'sample_1' }],
        auditRows: [{ candidate_id: 'cand_1', status: 'fail' }],
      })
    ).toThrow(/did not pass audit/);
  });
});
