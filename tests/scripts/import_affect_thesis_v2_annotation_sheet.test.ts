import { describe, expect, it } from 'vitest';

describe('import-affect-thesis-v2-annotation-sheet', () => {
  it('parses sheet/template/output arguments', async () => {
    const script = await import(
      '../../scripts/benchmarks/import-affect-thesis-v2-annotation-sheet.cjs'
    );

    const parsed = script.parseArgs([
      '--sheet',
      'tmp/sheet.csv',
      '--template',
      'tmp/template.jsonl',
      '--output',
      'tmp/out.jsonl',
    ]);

    expect(parsed).toEqual(
      expect.objectContaining({
        sheetPath: 'tmp/sheet.csv',
        templatePath: 'tmp/template.jsonl',
        outputPath: 'tmp/out.jsonl',
      })
    );
  });

  it('imports filled sheet labels back into the canonical annotation rows', async () => {
    const script = await import(
      '../../scripts/benchmarks/import-affect-thesis-v2-annotation-sheet.cjs'
    );

    const result = script.importAnnotationSheet({
      templateRows: [
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
      ],
      sheetRows: [
        {
          annotator_id: 'annotator_a',
          round_id: 'formal_v2',
          case_id: 'case_1',
          sample_id: 'sample_1',
          candidate_id: 'cand_1',
          risk_level: 'medium',
          intervention_state: 'co_plan',
          escalate: '0',
          notes: '当前更像低压力共同行动。',
        },
      ],
    });

    expect(result.rows).toEqual([
      {
        annotator_id: 'annotator_a',
        round_id: 'formal_v2',
        case_id: 'case_1',
        sample_id: 'sample_1',
        candidate_id: 'cand_1',
        labels: {
          risk_level: 'medium',
          intervention_state: 'co_plan',
          escalate: 0,
        },
        notes: '当前更像低压力共同行动。',
      },
    ]);
    expect(result.summary).toEqual(
      expect.objectContaining({
        total_rows: 1,
        completed_rows: 1,
      })
    );
  });
});
