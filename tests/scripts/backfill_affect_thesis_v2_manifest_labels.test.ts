import { describe, expect, it } from 'vitest';

describe('backfill-affect-thesis-v2-manifest-labels', () => {
  it('parses annotation/adjudication/output arguments', async () => {
    const script = await import(
      '../../scripts/benchmarks/backfill-affect-thesis-v2-manifest-labels.cjs'
    );
    const parsed = script.parseArgs([
      '--manifest',
      'tmp/manifest.jsonl',
      '--annotations',
      'tmp/annotations-a.jsonl,tmp/annotations-b.jsonl',
      '--adjudications',
      'tmp/adjudications.jsonl',
      '--round-id',
      'formal_v1',
      '--output',
      'tmp/out.jsonl',
      '--summary',
      'tmp/summary.json',
    ]);

    expect(parsed).toEqual(
      expect.objectContaining({
        manifestPath: 'tmp/manifest.jsonl',
        annotationPaths: ['tmp/annotations-a.jsonl', 'tmp/annotations-b.jsonl'],
        adjudicationPaths: ['tmp/adjudications.jsonl'],
        roundId: 'formal_v1',
        outputPath: 'tmp/out.jsonl',
        summaryPath: 'tmp/summary.json',
      })
    );
  });

  it('backfills consensus labels into the manifest', async () => {
    const script = await import(
      '../../scripts/benchmarks/backfill-affect-thesis-v2-manifest-labels.cjs'
    );
    const result = script.backfillManifestLabels({
      manifestRows: [
        {
          sample_id: 'sample_1',
          case_id: 'case_1',
          selected_candidate_id: 'cand_1',
          annotation_status: 'pending',
          adjudication_status: 'pending',
          final_labels: null,
          final_label_notes: null,
          annotation_log_ref: null,
          adjudication_log_ref: null,
        },
      ],
      annotationRows: [
        {
          sample_id: 'sample_1',
          case_id: 'case_1',
          candidate_id: 'cand_1',
          annotator_id: 'a',
          round_id: 'formal_v1',
          labels: {
            risk_level: 'medium',
            intervention_state: 'co_plan',
            escalate: 0,
          },
        },
        {
          sample_id: 'sample_1',
          case_id: 'case_1',
          candidate_id: 'cand_1',
          annotator_id: 'b',
          round_id: 'formal_v1',
          labels: {
            risk_level: 'medium',
            intervention_state: 'co_plan',
            escalate: 0,
          },
        },
      ],
      adjudicationRows: [],
      roundId: 'formal_v1',
      annotationLogRef: 'annotations.formal_v1.jsonl',
      adjudicationLogRef: null,
    });

    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        annotation_status: 'complete',
        adjudication_status: 'not_required',
        final_labels: {
          risk_level: 'medium',
          intervention_state: 'co_plan',
          escalate: 0,
          rationale: null,
        },
        annotation_log_ref: 'annotations.formal_v1.jsonl',
        adjudication_log_ref: null,
      })
    );
    expect(result.rows[0].final_label_notes).toContain('2 位标注者一致');
    expect(result.summary).toEqual(
      expect.objectContaining({
        rows_backfilled: 1,
        rows_backfilled_from_consensus: 1,
        rows_pending_adjudication: 0,
      })
    );
  });

  it('uses adjudication labels when annotations conflict', async () => {
    const script = await import(
      '../../scripts/benchmarks/backfill-affect-thesis-v2-manifest-labels.cjs'
    );
    const result = script.backfillManifestLabels({
      manifestRows: [
        {
          sample_id: 'sample_1',
          case_id: 'case_1',
          selected_candidate_id: 'cand_1',
          annotation_status: 'pending',
          adjudication_status: 'pending',
          final_labels: null,
          final_label_notes: null,
          annotation_log_ref: null,
          adjudication_log_ref: null,
        },
      ],
      annotationRows: [
        {
          sample_id: 'sample_1',
          case_id: 'case_1',
          candidate_id: 'cand_1',
          annotator_id: 'a',
          labels: {
            risk_level: 'medium',
            intervention_state: 'co_plan',
            escalate: 0,
          },
        },
        {
          sample_id: 'sample_1',
          case_id: 'case_1',
          candidate_id: 'cand_1',
          annotator_id: 'b',
          labels: {
            risk_level: 'medium',
            intervention_state: 'clarify',
            escalate: 0,
          },
        },
      ],
      adjudicationRows: [
        {
          sample_id: 'sample_1',
          case_id: 'case_1',
          candidate_id: 'cand_1',
          final_labels: {
            risk_level: 'medium',
            intervention_state: 'co_plan',
            escalate: 0,
            rationale: '裁决保留 co_plan',
          },
          reason: '以 affect 阻塞为主',
          manifest_update: {
            final_label_notes: '裁决后采用 co_plan。',
            annotation_log_ref: 'annotations.formal_v1.jsonl',
            adjudication_log_ref: 'adjudications.formal_v1.jsonl',
          },
        },
      ],
      roundId: null,
      annotationLogRef: 'annotations.default.jsonl',
      adjudicationLogRef: 'adjudications.default.jsonl',
    });

    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        annotation_status: 'complete',
        adjudication_status: 'resolved',
        final_labels: {
          risk_level: 'medium',
          intervention_state: 'co_plan',
          escalate: 0,
          rationale: '裁决保留 co_plan',
        },
        final_label_notes: '裁决后采用 co_plan。',
        annotation_log_ref: 'annotations.formal_v1.jsonl',
        adjudication_log_ref: 'adjudications.formal_v1.jsonl',
      })
    );
    expect(result.summary).toEqual(
      expect.objectContaining({
        rows_backfilled: 1,
        rows_backfilled_from_adjudication: 1,
      })
    );
  });

  it('leaves conflicting rows pending when adjudication is absent', async () => {
    const script = await import(
      '../../scripts/benchmarks/backfill-affect-thesis-v2-manifest-labels.cjs'
    );
    const result = script.backfillManifestLabels({
      manifestRows: [
        {
          sample_id: 'sample_1',
          case_id: 'case_1',
          selected_candidate_id: 'cand_1',
          annotation_status: 'pending',
          adjudication_status: 'pending',
          final_labels: null,
          final_label_notes: null,
          annotation_log_ref: null,
          adjudication_log_ref: null,
        },
      ],
      annotationRows: [
        {
          sample_id: 'sample_1',
          case_id: 'case_1',
          candidate_id: 'cand_1',
          annotator_id: 'a',
          labels: {
            risk_level: 'medium',
            intervention_state: 'co_plan',
            escalate: 0,
          },
        },
        {
          sample_id: 'sample_1',
          case_id: 'case_1',
          candidate_id: 'cand_1',
          annotator_id: 'b',
          labels: {
            risk_level: 'medium',
            intervention_state: 'clarify',
            escalate: 0,
          },
        },
      ],
      adjudicationRows: [],
      roundId: null,
      annotationLogRef: 'annotations.default.jsonl',
      adjudicationLogRef: null,
    });

    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        annotation_status: 'complete',
        adjudication_status: 'pending',
        final_labels: null,
      })
    );
    expect(result.summary).toEqual(
      expect.objectContaining({
        rows_backfilled: 0,
        rows_pending_adjudication: 1,
      })
    );
  });

  it('preserves already backfilled rows when this run does not include their logs', async () => {
    const script = await import(
      '../../scripts/benchmarks/backfill-affect-thesis-v2-manifest-labels.cjs'
    );
    const result = script.backfillManifestLabels({
      manifestRows: [
        {
          sample_id: 'sample_1',
          case_id: 'case_1',
          selected_candidate_id: 'cand_1',
          annotation_status: 'complete',
          adjudication_status: 'resolved',
          final_labels: {
            risk_level: 'medium',
            intervention_state: 'co_plan',
            escalate: 0,
            rationale: 'prior adjudication',
          },
          final_label_notes: '已有裁决',
          annotation_log_ref: 'annotations.formal_v1.jsonl',
          adjudication_log_ref: 'adjudications.formal_v1.jsonl',
        },
      ],
      annotationRows: [],
      adjudicationRows: [],
      roundId: 'formal_v1',
      annotationLogRef: 'annotations.formal_v1.jsonl',
      adjudicationLogRef: 'adjudications.formal_v1.jsonl',
    });

    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        annotation_status: 'complete',
        adjudication_status: 'resolved',
        final_labels: {
          risk_level: 'medium',
          intervention_state: 'co_plan',
          escalate: 0,
          rationale: 'prior adjudication',
        },
      })
    );
    expect(result.summary).toEqual(
      expect.objectContaining({
        rows_backfilled: 0,
        rows_pending_annotation: 0,
        rows_pending_adjudication: 0,
      })
    );
  });

  it('rejects duplicate annotation rows from the same annotator', async () => {
    const script = await import(
      '../../scripts/benchmarks/backfill-affect-thesis-v2-manifest-labels.cjs'
    );

    expect(() =>
      script.backfillManifestLabels({
        manifestRows: [
          {
            sample_id: 'sample_1',
            case_id: 'case_1',
            selected_candidate_id: 'cand_1',
            annotation_status: 'pending',
            adjudication_status: 'pending',
            final_labels: null,
            final_label_notes: null,
            annotation_log_ref: null,
            adjudication_log_ref: null,
          },
        ],
        annotationRows: [
          {
            sample_id: 'sample_1',
            case_id: 'case_1',
            candidate_id: 'cand_1',
            annotator_id: 'annotator_a',
            labels: {
              risk_level: 'medium',
              intervention_state: 'co_plan',
              escalate: 0,
            },
          },
          {
            sample_id: 'sample_1',
            case_id: 'case_1',
            candidate_id: 'cand_1',
            annotator_id: 'annotator_a',
            labels: {
              risk_level: 'medium',
              intervention_state: 'co_plan',
              escalate: 0,
            },
          },
        ],
        adjudicationRows: [],
      })
    ).toThrow(/Duplicate annotation row/);
  });
});
