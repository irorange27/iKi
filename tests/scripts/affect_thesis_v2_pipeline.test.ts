import { describe, expect, it } from 'vitest';

describe('affect-thesis-v2 pipeline', () => {
  it('supports scaffold -> packets -> ingest -> audit -> freeze in memory', async () => {
    const scaffold = await import('../../scripts/benchmarks/scaffold-affect-thesis-v2-manifest.cjs');
    const packets = await import(
      '../../scripts/benchmarks/build-affect-thesis-v2-prompt-packets.cjs'
    );
    const ingest = await import(
      '../../scripts/benchmarks/ingest-affect-thesis-v2-candidate-batches.cjs'
    );
    const audit = await import('../../scripts/benchmarks/audit-affect-thesis-v2-candidates.cjs');
    const select = await import(
      '../../scripts/benchmarks/backfill-affect-thesis-v2-manifest-selections.cjs'
    );
    const backfill = await import(
      '../../scripts/benchmarks/backfill-affect-thesis-v2-manifest-labels.cjs'
    );
    const freeze = await import('../../scripts/benchmarks/freeze-affect-thesis-v2-dataset.cjs');

    const manifestRows = scaffold.buildManifestFromBlueprint({
      candidate_quota_per_slot: 1,
      main_affect: {
        split: 'main_affect',
        variants: [
          {
            variant_id: 'blocked_by_affect',
            writer_intent: 'blocked candidate',
            default_gold: {
              risk_level: 'medium',
              intervention_state: 'co_plan',
              escalate: 0,
              rationale_stub: 'blocked by affect',
            },
            latent_defaults: {
              goal_clarity: 'high',
              authority_clarity: 'high',
              missing_info_level: 'low',
              affect_load_level: 'medium',
              readiness_to_act_level: 'low',
              functional_impairment_level: 'medium',
              boundary_risk_level: 'low',
              decision_ambiguity_level: 'low',
            },
            cue_banlist: [],
          },
        ],
        base_tasks: [
          {
            base_task_id: 'task_a',
            slice: 'slice_a',
            task_domain: 'communication',
            subtemplate: 'sub_a',
            source_recipe: 'native_written',
            scenario_stub: 'scenario_a',
            task_context_by_variant: {
              blocked_by_affect: {
                goal: 'goal_a',
                deliverable: 'deliverable_a',
                constraints: ['c1'],
              },
            },
          },
        ],
      },
      neutral_control: {
        split: 'neutral_control',
        tasks: [
          {
            base_task_id: 'task_b',
            variant_id: 'neutral_direct',
            slice: 'neutral_productivity_control',
            task_domain: 'work',
            subtemplate: 'sub_b',
            source_recipe: 'native_written',
            scenario_stub: 'scenario_b',
            task_context: {
              goal: 'goal_b',
              deliverable: 'deliverable_b',
              constraints: ['c2'],
            },
            default_gold: {
              risk_level: 'low',
              intervention_state: 'autonomous_execute',
              escalate: 0,
              rationale_stub: 'ready',
            },
          },
        ],
      },
    });

    const promptPackets = packets.buildPromptPackets(manifestRows, {
      shared_system_prompt: 'system',
      split_specific_instructions: {
        main_affect: ['keep affect'],
        neutral_control: ['stay neutral'],
      },
      writer_checklist: ['do not leak'],
      output_contract: {
        top_level_type: 'json_object',
        fields: ['sample_id', 'candidates'],
      },
      render_notes: {
        main_affect_packet_template: 'main packet',
        neutral_control_packet_template: 'neutral packet',
      },
    });

    expect(promptPackets).toHaveLength(2);

    const { candidateRows } = ingest.flattenCandidateBatches({
      manifestRows,
      batchRowsByInput: [
        {
          inputPath: 'tmp/batches.jsonl',
          rows: manifestRows.map((row) => ({
            sample_id: row.sample_id,
            packet_id: `packet_${row.sample_id}`,
            batch_id: 'round1',
            source_type: 'manual',
            author_id: 'author_a',
            candidates: [
              {
                history: [{ role: 'user', text: `${row.case_id} history` }],
                current_user_message: `${row.case_id} current`,
                task_context: {
                  goal: row.task_context_stub,
                  deliverable: row.task_context_deliverable_stub,
                  constraints: row.task_context_constraints_stub,
                },
                author_notes: 'draft',
              },
            ],
          })),
        },
      ],
    });

    const auditRows = audit.auditCandidates({ manifestRows, candidateRows });
    expect(auditRows.every((row) => row.status === 'pass')).toBe(true);

    const selectedManifestRows = select.backfillManifestSelections({
      manifestRows,
      selectionRows: manifestRows.map((row, index) => ({
        sample_id: row.sample_id,
        selected_candidate_id: candidateRows[index].candidate_id,
        rejected_candidate_ids: [],
        selected_candidate_notes: 'pipeline test selection',
      })),
      candidateRows,
      auditRows,
    }).rows;

    const annotationRows = selectedManifestRows.flatMap((row) => [
      {
        sample_id: row.sample_id,
        case_id: row.case_id,
        candidate_id: row.selected_candidate_id,
        annotator_id: 'annotator_a',
        round_id: 'formal_v1',
        labels: {
          risk_level: row.expected_label_tendency.risk_level,
          intervention_state: row.expected_label_tendency.intervention_state,
          escalate: row.expected_label_tendency.escalate,
        },
      },
      {
        sample_id: row.sample_id,
        case_id: row.case_id,
        candidate_id: row.selected_candidate_id,
        annotator_id: 'annotator_b',
        round_id: 'formal_v1',
        labels: {
          risk_level: row.expected_label_tendency.risk_level,
          intervention_state: row.expected_label_tendency.intervention_state,
          escalate: row.expected_label_tendency.escalate,
        },
      },
    ]);

    const backfilled = backfill.backfillManifestLabels({
      manifestRows: selectedManifestRows,
      annotationRows,
      adjudicationRows: [],
      roundId: 'formal_v1',
      annotationLogRef: 'annotation-log.formal_v1.jsonl',
      adjudicationLogRef: null,
    });

    const frozen = freeze.freezeDataset({
      manifestRows: backfilled.rows,
      candidateRows,
      auditRows,
    });

    expect(frozen.cases).toHaveLength(2);
    expect(frozen.gold).toHaveLength(2);
    expect(frozen.provenance.every((row: { label_source: string }) => row.label_source === 'final_labels')).toBe(true);
  });
});
