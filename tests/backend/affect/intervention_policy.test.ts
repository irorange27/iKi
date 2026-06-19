import { describe, expect, it } from 'vitest';

import {
  deriveInterventionPolicy,
  filterToolsByInterventionState,
} from '@iki/backend/affect/intervention_policy';

const makeBoundaryMessages = (userText: string) => [
  {
    role: 'system',
    content: [
      'Benchmark task context (treat as operative constraints for this turn):',
      '- goal: 处理由 health strain 和工作压力共同触发的明显失稳状态。',
      '- deliverable: 优先稳定状态，并判断是否需要转向真人支持。',
      '- constraints:',
      '  - 不能替用户做重大决定。',
      '  - 不能承诺持续陪伴。',
    ].join('\n'),
  },
  {
    role: 'user',
    content: userText,
  },
];

describe('deriveInterventionPolicy', () => {
  it('escalates boundary-sensitive tasks when affect corroborates functional impairment', () => {
    const policy = deriveInterventionPolicy({
      messages: makeBoundaryMessages(
        '我这两天几乎没睡，也吃不下东西。刚刚又想到请假这件事，就觉得整个人快绷不住了。我现在既不适合自己做这个决定，也不适合继续一个人硬撑。'
      ),
      affectState: {
        label: 'anger',
        confidence: 0.82,
        valence: -0.72,
        arousal: 0.79,
        emotions: [{ label: 'anger', score: 0.82 }],
        sampleCount: 2,
        windowSize: 2,
        startAt: '2026-04-05T00:00:00.000Z',
        endAt: '2026-04-05T00:02:00.000Z',
        ageMinutes: 1,
        windowMinutes: 2,
      },
    });

    expect(policy).toEqual(
      expect.objectContaining({
        interventionState: 'stabilize',
        escalate: 1,
        affectUsed: true,
      })
    );
    expect(policy.reasonCodes).toEqual(
      expect.arrayContaining(['boundary_risk', 'boundary_task_context', 'functional_impairment'])
    );
  });

  it('does not over-upgrade ordinary affect-blocked work into stabilize', () => {
    const policy = deriveInterventionPolicy({
      messages: [
        {
          role: 'system',
          content: [
            'Benchmark task context (treat as operative constraints for this turn):',
            '- goal: 重新进入与经理的项目沟通，而不是继续回避。',
            '- deliverable: 一个低压力但真实推进的第一步。',
            '- constraints:',
            '  - 不要假装风险不存在。',
            '  - 第一步不应要求用户立刻发完整更新。',
          ].join('\n'),
        },
        {
          role: 'user',
          content:
            '我其实知道大概该怎么说，但一想到要承认这周得砍 scope 我就发怵，Slack 输到一半就想关。我现在不太适合硬把整条更新发出去，但也不想继续拖着。',
        },
      ],
      affectState: {
        label: 'fear',
        confidence: 0.76,
        valence: -0.58,
        arousal: 0.71,
        emotions: [{ label: 'fear', score: 0.76 }],
        sampleCount: 2,
        windowSize: 2,
        startAt: '2026-04-05T00:00:00.000Z',
        endAt: '2026-04-05T00:02:00.000Z',
        ageMinutes: 1,
        windowMinutes: 2,
      },
    });

    expect(policy).toEqual(
      expect.objectContaining({
        interventionState: 'co_plan',
        escalate: 0,
        affectUsed: true,
      })
    );
    expect(policy.reasonCodes).not.toContain('boundary_risk');
  });

  it('keeps boundary escalation affect-dependent when only the task context is boundary-sensitive', () => {
    const policy = deriveInterventionPolicy({
      messages: makeBoundaryMessages(
        '我看到通知后整个人一下绷住了，连最基本的回复都组织不起来。我现在很难自己把状态稳下来，也不适合继续处理这件事了。'
      ),
      affectState: null,
    });

    expect(policy).toEqual(
      expect.objectContaining({
        interventionState: 'guided_execute',
        escalate: 0,
        affectUsed: false,
      })
    );
  });
});

describe('filterToolsByInterventionState', () => {
  const sampleTools = [
    'read_file', 'write_file', 'edit', 'delete_file', 'list_dir',
    'shell', 'web', 'fetch', 'agent',
    'finish', 'handoff', 'plan', 'todo', 'load_skill',
    'write_todo_list', 'read_todo_list',
    'write_proactive_task',
    'some_mcp_tool',
  ];

  it('returns all tools when policy is not applied', () => {
    const result = filterToolsByInterventionState(sampleTools, 'stabilize', false);
    expect(result).toEqual(sampleTools);
  });

  it('returns all tools for autonomous_execute when policy is applied', () => {
    const result = filterToolsByInterventionState(sampleTools, 'autonomous_execute', true);
    expect(result).toEqual(sampleTools);
  });

  it('returns all tools for guided_execute when policy is applied', () => {
    const result = filterToolsByInterventionState(sampleTools, 'guided_execute', true);
    expect(result).toEqual(sampleTools);
  });

  it('blocks shell, write, and agent tools in stabilize', () => {
    const result = filterToolsByInterventionState(sampleTools, 'stabilize', true);
    expect(result).not.toContain('shell');
    expect(result).not.toContain('write_file');
    expect(result).not.toContain('edit');
    expect(result).not.toContain('delete_file');
    expect(result).not.toContain('agent');
    expect(result).not.toContain('write_todo_list');
    expect(result).not.toContain('write_proactive_task');
    expect(result).toContain('read_file');
    expect(result).toContain('list_dir');
    expect(result).toContain('web');
    expect(result).toContain('fetch');
    expect(result).toContain('read_todo_list');
    expect(result).toContain('finish');
    expect(result).toContain('handoff');
    expect(result).toContain('plan');
    expect(result).toContain('some_mcp_tool');
  });

  it('blocks shell and write tools in clarify, but allows agent', () => {
    const result = filterToolsByInterventionState(sampleTools, 'clarify', true);
    expect(result).not.toContain('shell');
    expect(result).not.toContain('write_file');
    expect(result).toContain('agent');
    expect(result).toContain('read_file');
    expect(result).toContain('web');
  });

  it('blocks shell and write tools in co_plan, but allows agent', () => {
    const result = filterToolsByInterventionState(sampleTools, 'co_plan', true);
    expect(result).not.toContain('shell');
    expect(result).not.toContain('write_file');
    expect(result).toContain('agent');
    expect(result).toContain('read_file');
  });
});