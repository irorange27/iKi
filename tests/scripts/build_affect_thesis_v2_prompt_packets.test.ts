import { describe, expect, it } from 'vitest';

describe('build-affect-thesis-v2-prompt-packets', () => {
  it('parses manifest/prompts/output overrides', async () => {
    const script = await import('../../scripts/benchmarks/build-affect-thesis-v2-prompt-packets.cjs');
    const parsed = script.parseArgs([
      '--manifest',
      'tmp/manifest.jsonl',
      '--prompts',
      'tmp/prompts.json',
      '--output',
      'tmp/packets.jsonl',
    ]);

    expect(parsed).toEqual(
      expect.objectContaining({
        manifestPath: 'tmp/manifest.jsonl',
        promptsPath: 'tmp/prompts.json',
        outputPath: 'tmp/packets.jsonl',
      })
    );
  });

  it('renders packet prompts from manifest rows', async () => {
    const script = await import('../../scripts/benchmarks/build-affect-thesis-v2-prompt-packets.cjs');
    const packet = script.renderPromptPacket(
      {
        sample_id: 'manifest_thesis_main_v2_001',
        case_id: 'thesis_main_v2_001',
        split: 'main_affect',
        base_task_id: 'task_a',
        variant_id: 'blocked_by_affect',
        slice: 'slice_a',
        task_domain: 'communication',
        subtemplate: 'sub_a',
        source_recipe: 'native_written',
        scenario_stub: 'scenario_a',
        writer_intent: 'write a blocked candidate',
        goal_clarity: 'high',
        authority_clarity: 'high',
        missing_info_level: 'low',
        affect_load_level: 'medium',
        readiness_to_act_level: 'low',
        functional_impairment_level: 'medium',
        boundary_risk_level: 'low',
        decision_ambiguity_level: 'low',
        task_context_stub: 're-enter the task',
        task_context_deliverable_stub: 'one low-pressure next step',
        task_context_constraints_stub: ['no full draft yet'],
        expected_label_tendency: {
          risk_level: 'medium',
          intervention_state: 'co_plan',
          escalate: 0,
          rationale_stub: 'task clear but affect-blocked',
        },
        candidate_quota: 3,
        generation_template_id: 'main_affect_candidate_writer_v1',
        cue_banlist: ['先帮我把第一步缩小'],
      },
      {
        shared_system_prompt: 'system prompt',
        split_specific_instructions: {
          main_affect: ['keep the task real'],
        },
        writer_checklist: ['do not leak the label'],
        output_contract: {
          top_level_type: 'json_object',
          fields: ['sample_id', 'candidates'],
        },
        render_notes: {
          main_affect_packet_template: 'generate main candidates',
          neutral_control_packet_template: 'generate neutral candidates',
        },
      }
    );

    expect(packet).toEqual(
      expect.objectContaining({
        packet_id: 'packet_manifest_thesis_main_v2_001',
        candidate_quota: 3,
        system_prompt: 'system prompt',
      })
    );
    expect(packet.user_prompt).toContain('variant_id: blocked_by_affect');
    expect(packet.user_prompt).toContain('cue_banlist: 先帮我把第一步缩小');
    expect(packet.user_prompt).toContain('candidates 数量必须等于 3');
  });
});
