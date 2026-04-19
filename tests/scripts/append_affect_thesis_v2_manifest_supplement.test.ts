import { describe, expect, it } from 'vitest';

describe('append-affect-thesis-v2-manifest-supplement', () => {
  it('parses manifest and supplement overrides', async () => {
    const script = await import(
      '../../scripts/benchmarks/append-affect-thesis-v2-manifest-supplement.cjs'
    );
    const parsed = script.parseArgs([
      '--manifest',
      'tmp/manifest.jsonl',
      '--blueprint',
      'tmp/supplement.json',
      '--summary',
      'tmp/summary.json',
      '--output',
      'tmp/out.jsonl',
    ]);

    expect(parsed).toEqual(
      expect.objectContaining({
        manifestPath: 'tmp/manifest.jsonl',
        blueprintPath: 'tmp/supplement.json',
        summaryPath: 'tmp/summary.json',
        outputPath: 'tmp/out.jsonl',
      })
    );
  });

  it('appends neutral supplement rows after the current neutral index', async () => {
    const script = await import(
      '../../scripts/benchmarks/append-affect-thesis-v2-manifest-supplement.cjs'
    );

    const result = script.appendManifestSupplement({
      manifestRows: [
        {
          sample_id: 'manifest_thesis_main_v2_001',
          case_id: 'thesis_main_v2_001',
          split: 'main_affect',
        },
        {
          sample_id: 'manifest_thesis_neutral_v2_012',
          case_id: 'thesis_neutral_v2_012',
          split: 'neutral_control',
        },
      ],
      supplementBlueprint: {
        candidate_quota_per_slot: 6,
        neutral_control: {
          split: 'neutral_control',
          tasks: [
            {
              base_task_id: 'neutral_task_13',
              variant_id: 'neutral_guided',
              slice: 'neutral_productivity_control',
              task_domain: 'work',
              subtemplate: 'plain_guided',
              source_recipe: 'productivity_template',
              scenario_stub: 'scenario',
              task_context: {
                goal: 'goal',
                deliverable: 'deliverable',
                constraints: ['c1'],
              },
              default_gold: {
                risk_level: 'low',
                intervention_state: 'guided_execute',
                escalate: 0,
                rationale_stub: 'guided',
              },
            },
          ],
        },
      },
    });

    expect(result.appendedRows).toHaveLength(1);
    expect(result.appendedRows[0]).toEqual(
      expect.objectContaining({
        sample_id: 'manifest_thesis_neutral_v2_013',
        case_id: 'thesis_neutral_v2_013',
        variant_id: 'neutral_guided',
      })
    );
    expect(result.rows).toHaveLength(3);
  });

  it('keeps prior and supplement blueprint paths deduplicated', async () => {
    const script = await import(
      '../../scripts/benchmarks/append-affect-thesis-v2-manifest-supplement.cjs'
    );

    expect(
      script.mergeBlueprintPaths(
        {
          blueprint_paths: ['research/affect-thesis-v2/blueprint.v1.json'],
        },
        'research/affect-thesis-v2/blueprint.neutral-balance-supplement.v1.json'
      )
    ).toEqual([
      'research/affect-thesis-v2/blueprint.v1.json',
      'research/affect-thesis-v2/blueprint.neutral-balance-supplement.v1.json',
    ]);
  });
});
