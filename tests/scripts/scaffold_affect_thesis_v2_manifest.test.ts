import { describe, expect, it } from 'vitest';

describe('scaffold-affect-thesis-v2-manifest', () => {
  it('parses blueprint and output overrides', async () => {
    const script = await import('../../scripts/benchmarks/scaffold-affect-thesis-v2-manifest.cjs');
    const parsed = script.parseArgs([
      '--blueprint',
      'tmp/blueprint.json',
      '--output-dir',
      'tmp/out',
    ]);

    expect(parsed).toEqual(
      expect.objectContaining({
        blueprintPath: 'tmp/blueprint.json',
        outputDir: 'tmp/out',
      })
    );
  });

  it('builds manifest rows for main and neutral slots', async () => {
    const script = await import('../../scripts/benchmarks/scaffold-affect-thesis-v2-manifest.cjs');
    const rows = script.buildManifestFromBlueprint({
      candidate_quota_per_slot: 4,
      main_affect: {
        split: 'main_affect',
        variants: [
          {
            variant_id: 'ready_execute',
            writer_intent: 'direct output',
            default_gold: {
              risk_level: 'low',
              intervention_state: 'autonomous_execute',
              escalate: 0,
              rationale_stub: 'ready',
            },
            latent_defaults: {
              goal_clarity: 'high',
              authority_clarity: 'high',
              missing_info_level: 'low',
              affect_load_level: 'medium',
              readiness_to_act_level: 'high',
              functional_impairment_level: 'low',
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
              ready_execute: {
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
            source_recipe: 'productivity_template',
            scenario_stub: 'scenario_b',
            task_context: {
              goal: 'goal_b',
              deliverable: 'deliverable_b',
              constraints: ['c2'],
            },
            default_gold: {
              risk_level: 'low',
              intervention_state: 'clarify',
              escalate: 0,
              rationale_stub: 'clarify',
            },
          },
        ],
      },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        sample_id: 'manifest_thesis_main_v2_001',
        case_id: 'thesis_main_v2_001',
        generation_template_id: script.MAIN_PACKET_TEMPLATE_ID,
        candidate_quota: 4,
      })
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({
        sample_id: 'manifest_thesis_neutral_v2_001',
        case_id: 'thesis_neutral_v2_001',
        generation_template_id: script.NEUTRAL_PACKET_TEMPLATE_ID,
        split: 'neutral_control',
        final_labels: null,
      })
    );
    expect(rows[1].expected_label_tendency.intervention_state).toBe('clarify');
  });
});
