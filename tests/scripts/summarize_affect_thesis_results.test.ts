import { describe, expect, it } from 'vitest';

describe('summarize-affect-thesis-results', () => {
  it('builds thesis-facing metrics, pairwise comparisons, and markdown text', async () => {
    const script = await import('../../scripts/benchmarks/summarize-affect-thesis-results.cjs');

    const caseMetadata = new Map([
      [
        'main_case',
        {
          caseId: 'main_case',
          setId: 'main',
          setLabel: '主测试集',
          baseTaskId: 'task_main',
          variantId: 'blocked_by_affect',
          variantLabel: '情绪阻塞',
          slice: 'blocked_work_by_emotional_load',
          taskDomain: 'work',
          goldLabels: {
            interventionState: 'co_plan',
            escalate: 0,
          },
        },
      ],
      [
        'neutral_case',
        {
          caseId: 'neutral_case',
          setId: 'neutral',
          setLabel: '中性对照集',
          baseTaskId: 'task_neutral',
          variantId: 'neutral_direct_message',
          variantLabel: 'neutral_direct_message',
          slice: 'neutral_productivity_control',
          taskDomain: 'communication',
          goldLabels: {
            interventionState: 'autonomous_execute',
            escalate: 0,
          },
        },
      ],
    ]);

    const runs = [
      {
        mode: 'no_affect',
        scoreRows: [
          {
            case_id: 'main_case',
            status: 'ok',
            valid_prediction: true,
            state_exact_match: 0,
            escalation_exact_match: 1,
            policy_over_intervention: 1,
            policy_under_help: 0,
            escalation_error: 0,
            policy_composite_error: 1,
          },
          {
            case_id: 'neutral_case',
            status: 'ok',
            valid_prediction: true,
            state_exact_match: 1,
            escalation_exact_match: 1,
            policy_over_intervention: 0,
            policy_under_help: 0,
            escalation_error: 0,
            policy_composite_error: 0,
          },
        ],
        parsedRows: [
          {
            ok: true,
            prediction: {
              case_id: 'main_case',
              policy_action: {
                intervention_state: 'guided_execute',
                escalate: 0,
              },
              metadata: {
                runtime_policy_applied: false,
                runtime_policy_affect_used: false,
              },
            },
          },
          {
            ok: true,
            prediction: {
              case_id: 'neutral_case',
              policy_action: {
                intervention_state: 'autonomous_execute',
                escalate: 0,
              },
              metadata: {
                runtime_policy_applied: false,
                runtime_policy_affect_used: false,
              },
            },
          },
        ],
      },
      {
        mode: 'tone_only',
        scoreRows: [
          {
            case_id: 'main_case',
            status: 'ok',
            valid_prediction: true,
            state_exact_match: 0,
            escalation_exact_match: 1,
            policy_over_intervention: 1,
            policy_under_help: 0,
            escalation_error: 0,
            policy_composite_error: 1,
          },
          {
            case_id: 'neutral_case',
            status: 'ok',
            valid_prediction: true,
            state_exact_match: 1,
            escalation_exact_match: 1,
            policy_over_intervention: 0,
            policy_under_help: 0,
            escalation_error: 0,
            policy_composite_error: 0,
          },
        ],
        parsedRows: [
          {
            ok: true,
            prediction: {
              case_id: 'main_case',
              policy_action: {
                intervention_state: 'guided_execute',
                escalate: 0,
              },
              metadata: {
                runtime_policy_applied: false,
                runtime_policy_affect_used: true,
              },
            },
          },
          {
            ok: true,
            prediction: {
              case_id: 'neutral_case',
              policy_action: {
                intervention_state: 'autonomous_execute',
                escalate: 0,
              },
              metadata: {
                runtime_policy_applied: false,
                runtime_policy_affect_used: false,
              },
            },
          },
        ],
      },
      {
        mode: 'explicit_policy',
        scoreRows: [
          {
            case_id: 'main_case',
            status: 'ok',
            valid_prediction: true,
            state_exact_match: 1,
            escalation_exact_match: 1,
            policy_over_intervention: 0,
            policy_under_help: 0,
            escalation_error: 0,
            policy_composite_error: 0,
          },
          {
            case_id: 'neutral_case',
            status: 'ok',
            valid_prediction: true,
            state_exact_match: 1,
            escalation_exact_match: 1,
            policy_over_intervention: 0,
            policy_under_help: 0,
            escalation_error: 0,
            policy_composite_error: 0,
          },
        ],
        parsedRows: [
          {
            ok: true,
            prediction: {
              case_id: 'main_case',
              policy_action: {
                intervention_state: 'co_plan',
                escalate: 0,
              },
              metadata: {
                runtime_policy_applied: true,
                runtime_policy_affect_used: true,
              },
            },
          },
          {
            ok: true,
            prediction: {
              case_id: 'neutral_case',
              policy_action: {
                intervention_state: 'autonomous_execute',
                escalate: 0,
              },
              metadata: {
                runtime_policy_applied: true,
                runtime_policy_affect_used: false,
              },
            },
          },
        ],
      },
    ];

    const setMetrics = script.buildSetMetrics({ runs, caseMetadata });
    const mainMetrics = setMetrics.find(
      (entry: { mode: string; setId: string }) =>
        entry.mode === 'explicit_policy' && entry.setId === 'main'
    );
    expect(mainMetrics).toEqual(
      expect.objectContaining({
        policy_composite_error_rate: 0,
      })
    );

    const mainVariantMetrics = script.buildMainVariantMetrics({ runs, caseMetadata });
    expect(mainVariantMetrics).toEqual([
      expect.objectContaining({
        variantId: 'blocked_by_affect',
        explicitVsNoAffectDelta: -1,
      }),
    ]);

    const runtimeAudit = script.buildRuntimeAudit({ runs, caseMetadata });
    expect(runtimeAudit.find((entry: { mode: string }) => entry.mode === 'explicit_policy')).toEqual(
      expect.objectContaining({
        all: expect.objectContaining({
          runtime_policy_applied_rate: 1,
          runtime_policy_affect_used_rate: 0.5,
        }),
      })
    );

    const pairwise = script.buildPairwiseComparison({ runs, caseMetadata });
    expect(pairwise).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetMode: 'explicit_policy',
          setId: 'main',
          policy_improved_rate: 1,
          predicted_action_change_rate: 1,
          target_runtime_policy_applied_rate: 1,
        }),
      ])
    );

    const narrative = script.buildNarrative({
      setMetrics,
      pairwiseComparisons: pairwise,
      runtimeAudit,
    });
    expect(narrative.join('\n')).toContain('主测试集');
    expect(narrative.join('\n')).toContain('动作变化率');

    const markdown = script.buildMarkdownReport({
      setMetrics,
      mainVariantMetrics,
      runtimeAudit,
      pairwiseComparisons: pairwise,
      narrative,
      runDirs: [
        { mode: 'no_affect', dir: '/tmp/no_affect' },
        { mode: 'tone_only', dir: '/tmp/tone_only' },
        { mode: 'explicit_policy', dir: '/tmp/explicit_policy' },
      ],
    });
    expect(markdown).toContain('## 表 1 主测试集总体结果');
    expect(markdown).toContain('显式情感策略');
  });
});
