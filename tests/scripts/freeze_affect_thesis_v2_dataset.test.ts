import { describe, expect, it } from 'vitest';

describe('freeze-affect-thesis-v2-dataset', () => {
  it('parses manifest/candidates/audit/output arguments', async () => {
    const script = await import('../../scripts/benchmarks/freeze-affect-thesis-v2-dataset.cjs');
    const parsed = script.parseArgs([
      '--manifest',
      'tmp/manifest.jsonl',
      '--candidates',
      'tmp/candidates.jsonl',
      '--audit',
      'tmp/audit.jsonl',
      '--output-dir',
      'tmp/frozen',
    ]);

    expect(parsed).toEqual(
      expect.objectContaining({
        manifestPath: 'tmp/manifest.jsonl',
        candidatesPath: 'tmp/candidates.jsonl',
        auditPath: 'tmp/audit.jsonl',
        outputDir: 'tmp/frozen',
      })
    );
  });

  it('freezes selected candidates into cases, gold, and provenance', async () => {
    const script = await import('../../scripts/benchmarks/freeze-affect-thesis-v2-dataset.cjs');
    const frozen = script.freezeDataset({
      manifestRows: [
        {
          sample_id: 'sample_1',
          case_id: 'thesis_main_v2_001',
          split: 'main_affect',
          base_task_id: 'task_a',
          variant_id: 'blocked_by_affect',
          slice: 'slice_a',
          task_domain: 'communication',
          generation_template_id: 'main_affect_candidate_writer_v1',
          selected_candidate_id: 'cand_1',
          selected_candidate_notes: 'best surface form',
          final_labels: {
            risk_level: 'medium',
            intervention_state: 'co_plan',
            escalate: 0,
            rationale: 'double annotation resolved to co_plan',
          },
          expected_label_tendency: {
            risk_level: 'medium',
            intervention_state: 'co_plan',
            escalate: 0,
            rationale_stub: 'task clear but affect-blocked',
          },
        },
      ],
      candidateRows: [
        {
          candidate_id: 'cand_1',
          sample_id: 'sample_1',
          source_type: 'llm',
          source_model: 'test-model',
          author_id: 'author_a',
          history: [{ role: 'user', text: 'u1' }],
          current_user_message: 'message',
          task_context: {
            goal: 'goal',
            deliverable: 'deliverable',
            constraints: ['c1'],
          },
        },
      ],
      auditRows: [
        {
          candidate_id: 'cand_1',
          status: 'pass',
          issue_count: 0,
          leakage_flags: [],
        },
      ],
    });

    expect(frozen.cases).toEqual([
      expect.objectContaining({
        case_id: 'thesis_main_v2_001',
        current_user_message: 'message',
      }),
    ]);
    expect(frozen.gold).toEqual([
      expect.objectContaining({
        case_id: 'thesis_main_v2_001',
        labels: expect.objectContaining({
          intervention_state: 'co_plan',
          escalate: 0,
          rationale: 'double annotation resolved to co_plan',
        }),
      }),
    ]);
    expect(frozen.provenance).toEqual([
      expect.objectContaining({
        case_id: 'thesis_main_v2_001',
        candidate_id: 'cand_1',
        selected_candidate_notes: 'best surface form',
        label_source: 'final_labels',
      }),
    ]);
  });

  it('rejects thesis freeze without adjudicated final labels by default', async () => {
    const script = await import('../../scripts/benchmarks/freeze-affect-thesis-v2-dataset.cjs');

    expect(() =>
      script.freezeDataset({
        manifestRows: [
          {
            sample_id: 'sample_1',
            case_id: 'thesis_main_v2_001',
            split: 'main_affect',
            base_task_id: 'task_a',
            variant_id: 'blocked_by_affect',
            slice: 'slice_a',
            task_domain: 'communication',
            generation_template_id: 'main_affect_candidate_writer_v1',
            selected_candidate_id: 'cand_1',
            expected_label_tendency: {
              risk_level: 'medium',
              intervention_state: 'co_plan',
              escalate: 0,
              rationale_stub: 'bootstrap expectation',
            },
          },
        ],
        candidateRows: [
          {
            candidate_id: 'cand_1',
            sample_id: 'sample_1',
            history: [{ role: 'user', text: 'u1' }],
            current_user_message: 'message',
            task_context: {
              goal: 'goal',
              deliverable: 'deliverable',
              constraints: ['c1'],
            },
          },
        ],
        auditRows: [
          {
            candidate_id: 'cand_1',
            status: 'pass',
            issue_count: 0,
            leakage_flags: [],
          },
        ],
      })
    ).toThrow(/final_labels/);
  });
});
