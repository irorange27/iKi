import { describe, expect, it } from 'vitest';

describe('derive-affect-thesis-manifest', () => {
  it('parses comma-separated CLI paths', async () => {
    const script = await import('../../scripts/benchmarks/derive-affect-thesis-manifest.cjs');
    const parsed = script.parseArgs([
      '--cases',
      'main.cases.jsonl,neutral.cases.jsonl',
      '--gold',
      'main.gold.jsonl,neutral.gold.jsonl',
      '--output',
      'research/affect-thesis/derived.jsonl',
    ]);

    expect(parsed).toEqual(
      expect.objectContaining({
        casesPaths: ['main.cases.jsonl', 'neutral.cases.jsonl'],
        goldPaths: ['main.gold.jsonl', 'neutral.gold.jsonl'],
        outputPath: 'research/affect-thesis/derived.jsonl',
      })
    );
  });

  it('flags explicit dependency and micro-step leakage cues', async () => {
    const script = await import('../../scripts/benchmarks/derive-affect-thesis-manifest.cjs');
    const audit = script.detectCueLeakage(
      '我一看到通知就开始发抖。你别断开，先帮我把第一步缩小。'
    );

    expect(audit.priority).toBe('high');
    expect(audit.flags.map((flag: { id: string }) => flag.id)).toEqual(
      expect.arrayContaining(['assistant_dependency', 'micro_step_directive', 'textbook_distress_cue'])
    );
  });

  it('derives thesis manifest entries with latent control fields and review priority', async () => {
    const script = await import('../../scripts/benchmarks/derive-affect-thesis-manifest.cjs');
    const entries = script.deriveManifestEntries({
      caseItems: [
        {
          case_id: 'screen_main_v2_002',
          base_task_id: 'manager_scope_tradeoff_update',
          variant_id: 'blocked_by_affect',
          slice: 'difficult_communication_tasks',
          history: [{ role: 'user', text: '我知道该给经理发更新。' }],
          current_user_message: 'Slack 输到一半就想关。先帮我把第一步缩到很小。',
          task_context: {
            goal: '重新进入与经理的项目沟通，而不是继续回避。',
          },
        },
        {
          case_id: 'screen_neutral_v2_010',
          base_task_id: 'neutral_vendor_email_missing_decision',
          variant_id: 'neutral_missing_decision',
          slice: 'neutral_productivity_control',
          history: [{ role: 'user', text: '我得回供应商那封邮件了。' }],
          current_user_message: '我还没决定接受报价还是先约 call。',
          task_context: {
            goal: '回复供应商且不误导实际立场。',
          },
        },
      ],
      goldItems: [
        {
          case_id: 'screen_main_v2_002',
          task_domain: 'communication',
          labels: {
            risk_level: 'medium',
            intervention_state: 'co_plan',
            escalate: 0,
          },
        },
        {
          case_id: 'screen_neutral_v2_010',
          task_domain: 'communication',
          labels: {
            risk_level: 'low',
            intervention_state: 'clarify',
            escalate: 0,
          },
        },
      ],
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        split: 'main_affect',
        subtemplate: 'hard_work_message',
        source_recipe: 'native_written',
        goal_clarity: 'high',
        readiness_to_act_level: 'low',
        thesis_review_priority: 'high',
        leakage_flags: expect.arrayContaining(['micro_step_directive']),
      })
    );
    expect(entries[1]).toEqual(
      expect.objectContaining({
        split: 'neutral',
        source_recipe: 'productivity_template',
        missing_info_level: 'high',
        decision_ambiguity_level: 'high',
        affect_load_level: 'low',
      })
    );
  });
});
