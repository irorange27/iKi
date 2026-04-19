import { describe, expect, it } from 'vitest';

describe('run-affect-benchmark', () => {
  it('parses CLI arguments for end-to-end scoring', async () => {
    const script = await import('../../scripts/benchmarks/run-affect-benchmark.cjs');
    const parsed = script.parseArgs([
      '--cases',
      'cases.jsonl',
      '--gold',
      'gold.jsonl',
      '--predictions',
      'predictions.jsonl',
      '--output-dir',
      'out',
      '--mode',
      'policy_only',
      '--seed',
      '7',
    ]);

    expect(parsed).toEqual(
      expect.objectContaining({
        casesPath: 'cases.jsonl',
        goldPath: 'gold.jsonl',
        predictionsPath: 'predictions.jsonl',
        outputDir: 'out',
        mode: 'policy_only',
        seed: 7,
      })
    );
  });

  it('scores over-intervention and escalation mistakes from policy actions', async () => {
    const script = await import('../../scripts/benchmarks/run-affect-benchmark.cjs');
    const score = script.scorePolicyDecision({
      goldLabels: {
        interventionState: 'co_plan',
        escalate: 0,
      },
      predictedPolicyAction: {
        interventionState: 'autonomous_execute',
        escalate: 1,
      },
    });

    expect(score).toEqual(
      expect.objectContaining({
        state_exact_match: 0,
        escalation_exact_match: 0,
        policy_over_intervention: 1,
        policy_under_help: 0,
        escalation_error: 1,
        policy_composite_error: 1,
      })
    );
  });

  it('fills missing predictions as benchmark errors during aggregation', async () => {
    const script = await import('../../scripts/benchmarks/run-affect-benchmark.cjs');
    const { results, systemIds } = script.scorePredictions({
      cases: [
        {
          caseId: 'case_1',
          slice: 'blocked_work_by_emotional_load',
          history: [{ role: 'user', text: 'a' }],
          currentUserMessage: 'b',
          taskContext: { goal: 'help user restart a blocked PR' },
        },
        {
          caseId: 'case_2',
          slice: 'neutral_productivity_control',
          history: [{ role: 'user', text: 'c' }],
          currentUserMessage: 'd',
          taskContext: { goal: 'draft a neutral status update' },
        },
      ],
      golds: [
        {
          caseId: 'case_1',
          slice: 'blocked_work_by_emotional_load',
          labels: {
            interventionState: 'co_plan',
            escalate: 0,
          },
        },
        {
          caseId: 'case_2',
          slice: 'neutral_productivity_control',
          labels: {
            interventionState: 'autonomous_execute',
            escalate: 0,
          },
        },
      ],
      predictions: [
        {
          caseId: 'case_1',
          systemId: 'M_proposed',
          policyAction: {
            interventionState: 'co_plan',
            escalate: 0,
          },
          assistantResponse: 'ok',
          metadata: null,
        },
      ],
    });

    expect(systemIds).toEqual(['M_proposed']);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          case_id: 'case_2',
          system_id: 'M_proposed',
          status: 'missing_prediction',
          valid_prediction: false,
          policy_composite_error: 1,
          policy_under_help: 1,
        }),
      ])
    );
  });

  it('builds deterministic blinded judge packets with task context only', async () => {
    const script = await import('../../scripts/benchmarks/run-affect-benchmark.cjs');
    const input = {
      cases: [
        {
          caseId: 'case_1',
          baseTaskId: 'task_1',
          variantId: 'variant_a',
          history: [{ role: 'user', text: 'hi' }],
          currentUserMessage: 'help',
          taskContext: { goal: 'draft a message', constraints: ['keep it brief'] },
        },
      ],
      golds: [{ caseId: 'case_1', baseTaskId: 'task_1', variantId: 'variant_a' }],
      predictionBySystemCase: new Map([
        [
          'A::case_1',
          {
            caseId: 'case_1',
            systemId: 'A',
            assistantResponse: 'response a',
          },
        ],
        [
          'B::case_1',
          {
            caseId: 'case_1',
            systemId: 'B',
            assistantResponse: 'response b',
          },
        ],
      ]),
      systemIds: ['A', 'B'],
      seed: 42,
      mode: 'end_to_end',
    };
    const packets = script.buildJudgePackets(input);
    const repeated = script.buildJudgePackets(input);

    expect(packets.judgeItems).toHaveLength(2);
    expect(packets.judgeKey).toHaveLength(2);
    expect(packets.judgeItems[0]).toEqual(
      expect.objectContaining({
        judge_item_id: 'judge_000001',
        case_id: 'case_1',
        base_task_id: 'task_1',
        variant_id: 'variant_a',
        case: expect.objectContaining({
          current_user_message: 'help',
          task_context: {
            goal: 'draft a message',
            constraints: ['keep it brief'],
          },
        }),
      })
    );
    expect(packets.judgeKey).toEqual(repeated.judgeKey);
    expect(
      packets.judgeKey.map((entry: { judge_item_id: string; system_id: string }) => entry.system_id)
    ).toEqual(expect.arrayContaining(['A', 'B']));
  });
});
