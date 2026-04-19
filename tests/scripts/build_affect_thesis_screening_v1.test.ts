import { describe, expect, it } from 'vitest';

describe('build-affect-thesis-screening-v1', () => {
  it('parses output-dir override while keeping default input paths', async () => {
    const script = await import('../../scripts/benchmarks/build-affect-thesis-screening-v1.cjs');
    const parsed = script.parseArgs(['--output-dir', 'tmp/thesis']);

    expect(parsed).toEqual(
      expect.objectContaining({
        mainCasesPath: script.DEFAULTS.mainCasesPath,
        neutralGoldPath: script.DEFAULTS.neutralGoldPath,
        outputDir: 'tmp/thesis',
      })
    );
  });

  it('rewrites high-priority cases and renumbers ids into thesis files', async () => {
    const script = await import('../../scripts/benchmarks/build-affect-thesis-screening-v1.cjs');
    const built = script.buildThesisScreeningV1({
      mainCases: [
        {
          case_id: 'screen_main_v2_002',
          base_task_id: 'manager_scope_tradeoff_update',
          variant_id: 'blocked_by_affect',
          slice: 'difficult_communication_tasks',
          history: [
            { role: 'user', text: 'u1' },
            { role: 'assistant', text: 'a1' },
            { role: 'user', text: 'u2' },
            { role: 'assistant', text: '你现在更需要完整 Slack，还是先把第一步缩小一点？' },
          ],
          current_user_message: '先帮我把第一步缩到很小。',
          task_context: { goal: 'g' },
        },
      ],
      mainGolds: [
        {
          case_id: 'screen_main_v2_002',
          labels: {
            risk_level: 'medium',
            intervention_state: 'co_plan',
            escalate: 0,
          },
        },
      ],
      neutralCases: [
        {
          case_id: 'screen_neutral_v2_001',
          base_task_id: 'neutral_reschedule_message',
          variant_id: 'neutral_direct_message',
          slice: 'neutral_productivity_control',
          history: [],
          current_user_message: 'x',
          task_context: { goal: 'y' },
        },
      ],
      neutralGolds: [
        {
          case_id: 'screen_neutral_v2_001',
          labels: {
            risk_level: 'low',
            intervention_state: 'autonomous_execute',
            escalate: 0,
          },
        },
      ],
    });

    expect(built.mainCases[0]).toEqual(
      expect.objectContaining({
        case_id: 'thesis_main_v1_001',
        current_user_message:
          '我其实知道大概该怎么说，但一想到要承认这周得砍 scope 我就发怵，Slack 输到一半就想关。我现在不太适合硬把整条更新发出去，但也不想继续拖着。',
        history: expect.arrayContaining([
          expect.objectContaining({
            text: '你现在更需要我陪你把这件事重新开个头，还是先说清你卡住的那一下？',
          }),
        ]),
      })
    );
    expect(built.mainGolds[0].case_id).toBe('thesis_main_v1_001');
    expect(built.neutralCases[0].case_id).toBe('thesis_neutral_v1_001');
    expect(built.caseMap[0]).toEqual(
      expect.objectContaining({
        legacy_case_id: 'screen_main_v2_002',
        case_id: 'thesis_main_v1_001',
        rewritten: true,
      })
    );
  });
});
