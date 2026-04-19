import { describe, expect, it } from 'vitest';

describe('scaffold-affect-thesis-v2-annotation-round', () => {
  it('parses round and annotator arguments', async () => {
    const script = await import(
      '../../scripts/benchmarks/scaffold-affect-thesis-v2-annotation-round.cjs'
    );

    const parsed = script.parseArgs([
      '--manifest',
      'tmp/manifest.jsonl',
      '--candidates',
      'tmp/candidates.jsonl',
      '--round-id',
      'formal_v2',
      '--annotators',
      'annotator_a,annotator_b,annotator_c',
      '--output-dir',
      'tmp/out',
      '--force',
    ]);

    expect(parsed).toEqual(
      expect.objectContaining({
        manifestPath: 'tmp/manifest.jsonl',
        candidatesPath: 'tmp/candidates.jsonl',
        roundId: 'formal_v2',
        annotatorIds: ['annotator_a', 'annotator_b', 'annotator_c'],
        outputDir: 'tmp/out',
        force: true,
      })
    );
  });

  it('builds a blinded workset plus per-annotator log skeletons from selected candidates', async () => {
    const script = await import(
      '../../scripts/benchmarks/scaffold-affect-thesis-v2-annotation-round.cjs'
    );

    const result = script.buildAnnotationRound({
      manifestRows: [
        {
          sample_id: 'sample_1',
          case_id: 'case_1',
          split: 'main_affect',
          selected_candidate_id: 'cand_1',
        },
        {
          sample_id: 'sample_2',
          case_id: 'case_2',
          split: 'neutral_control',
          selected_candidate_id: 'cand_2',
        },
      ],
      candidateRows: [
        {
          candidate_id: 'cand_1',
          sample_id: 'sample_1',
          case_id: 'case_1',
          history: [{ role: 'user', text: 'h1' }],
          current_user_message: 'u1',
          task_context: { goal: 'g1', deliverable: 'd1', constraints: ['c1'] },
        },
        {
          candidate_id: 'cand_2',
          sample_id: 'sample_2',
          case_id: 'case_2',
          history: [{ role: 'user', text: 'h2' }],
          current_user_message: 'u2',
          task_context: { goal: 'g2', deliverable: 'd2', constraints: ['c2'] },
        },
      ],
      roundId: 'formal_v1',
      annotatorIds: ['annotator_a', 'annotator_b'],
    });

    expect(result.worksetRows).toEqual([
      {
        annotation_packet_id: 'annotation_formal_v1_case_1',
        round_id: 'formal_v1',
        sample_id: 'sample_1',
        case_id: 'case_1',
        candidate_id: 'cand_1',
        history: [{ role: 'user', text: 'h1' }],
        current_user_message: 'u1',
        task_context: { goal: 'g1', deliverable: 'd1', constraints: ['c1'] },
      },
      {
        annotation_packet_id: 'annotation_formal_v1_case_2',
        round_id: 'formal_v1',
        sample_id: 'sample_2',
        case_id: 'case_2',
        candidate_id: 'cand_2',
        history: [{ role: 'user', text: 'h2' }],
        current_user_message: 'u2',
        task_context: { goal: 'g2', deliverable: 'd2', constraints: ['c2'] },
      },
    ]);
    expect(result.annotationRowsByAnnotator.annotator_a[0]).toEqual({
      case_id: 'case_1',
      sample_id: 'sample_1',
      candidate_id: 'cand_1',
      annotator_id: 'annotator_a',
      round_id: 'formal_v1',
      labels: {
        risk_level: null,
        intervention_state: null,
        escalate: null,
      },
      notes: '',
    });
    expect(result.summary).toEqual(
      expect.objectContaining({
        round_id: 'formal_v1',
        selected_row_count: 2,
        annotator_ids: ['annotator_a', 'annotator_b'],
        split_counts: {
          main_affect: 1,
          neutral_control: 1,
        },
      })
    );
  });

  it('rejects selected candidates whose ids do not map back to the manifest row', async () => {
    const script = await import(
      '../../scripts/benchmarks/scaffold-affect-thesis-v2-annotation-round.cjs'
    );

    expect(() =>
      script.buildAnnotationRound({
        manifestRows: [
          {
            sample_id: 'sample_1',
            case_id: 'case_1',
            split: 'main_affect',
            selected_candidate_id: 'cand_1',
          },
        ],
        candidateRows: [
          {
            candidate_id: 'cand_1',
            sample_id: 'sample_other',
            case_id: 'case_1',
            history: [],
            current_user_message: 'u1',
            task_context: { goal: 'g1', deliverable: 'd1', constraints: [] },
          },
        ],
        roundId: 'formal_v1',
        annotatorIds: ['annotator_a', 'annotator_b'],
      })
    ).toThrow(/belongs to sample_id=sample_other/);
  });
});
