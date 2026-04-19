import { describe, expect, it } from 'vitest';

describe('export-affect-thesis-v2-annotation-sheets', () => {
  it('parses workset and annotation paths', async () => {
    const script = await import(
      '../../scripts/benchmarks/export-affect-thesis-v2-annotation-sheets.cjs'
    );

    const parsed = script.parseArgs([
      '--workset',
      'tmp/workset.jsonl',
      '--annotations',
      'tmp/a.jsonl,tmp/b.jsonl',
      '--output-dir',
      'tmp/out',
    ]);

    expect(parsed).toEqual(
      expect.objectContaining({
        worksetPath: 'tmp/workset.jsonl',
        annotationPaths: ['tmp/a.jsonl', 'tmp/b.jsonl'],
        outputDir: 'tmp/out',
      })
    );
  });

  it('builds csv-ready annotation rows from workset and annotation logs', async () => {
    const script = await import(
      '../../scripts/benchmarks/export-affect-thesis-v2-annotation-sheets.cjs'
    );

    const rows = script.buildSheetRows(
      [
        {
          candidate_id: 'cand_1',
          history: [
            { role: 'user', text: '第一句' },
            { role: 'assistant', text: '第二句' },
          ],
          current_user_message: '当前问题',
          task_context: {
            goal: '目标',
            deliverable: '交付物',
            constraints: ['约束一', '约束二'],
          },
        },
      ],
      [
        {
          annotator_id: 'annotator_a',
          round_id: 'formal_v2',
          case_id: 'case_1',
          sample_id: 'sample_1',
          candidate_id: 'cand_1',
          labels: {
            risk_level: null,
            intervention_state: null,
            escalate: null,
          },
          notes: '',
        },
      ]
    );

    expect(rows).toEqual([
      {
        annotator_id: 'annotator_a',
        round_id: 'formal_v2',
        case_id: 'case_1',
        sample_id: 'sample_1',
        candidate_id: 'cand_1',
        history_text: '用户: 第一句\n助手: 第二句',
        current_user_message: '当前问题',
        task_goal: '目标',
        task_deliverable: '交付物',
        task_constraints: '- 约束一\n- 约束二',
        risk_level: '',
        intervention_state: '',
        escalate: '',
        notes: '',
      },
    ]);
  });
});
