import { describe, expect, it } from 'vitest';

import { computePinnedSkills } from '../../../../packages/desktop/src/main/services/workflow/workflow_optimizer.ts';
import type { WorkflowOptimizationConfig, WorkflowProfile } from '@iki/core/types/workflow';

const baseConfig: WorkflowOptimizationConfig = {
  enabled: true,
  autoPinSkills: true,
  minAutoSkillRuns: 5,
  minSkillSelections: 3,
  pinConfidence: 0.6,
  unpinConfidence: 0.4,
  maxPinnedSkills: 2,
};

describe('computePinnedSkills', () => {
  it('pins skills that meet confidence and selection thresholds', () => {
    const profile: WorkflowProfile = {
      version: 1,
      stats: { autoSkillRuns: 6 },
      skills: {
        'skill-a': { selections: 4 },
        'skill-b': { selections: 4 },
        'skill-c': { selections: 1 },
      },
      pinnedSkills: [],
    };

    const pinned = computePinnedSkills({
      profile,
      config: baseConfig,
      availableSkillIds: new Set(['skill-a', 'skill-b', 'skill-c']),
    });

    expect(pinned).toEqual(['skill-a', 'skill-b']);
  });

  it('unpins skills that fall below the release threshold', () => {
    const profile: WorkflowProfile = {
      version: 1,
      stats: { autoSkillRuns: 10 },
      skills: {
        'skill-a': { selections: 2 },
      },
      pinnedSkills: ['skill-a'],
    };

    const pinned = computePinnedSkills({
      profile,
      config: baseConfig,
      availableSkillIds: new Set(['skill-a']),
    });

    expect(pinned).toEqual([]);
  });

  it('respects maxPinnedSkills ordering by confidence', () => {
    const profile: WorkflowProfile = {
      version: 1,
      stats: { autoSkillRuns: 8 },
      skills: {
        'skill-a': { selections: 6 },
        'skill-b': { selections: 5 },
        'skill-c': { selections: 4 },
      },
      pinnedSkills: [],
    };

    const pinned = computePinnedSkills({
      profile,
      config: { ...baseConfig, maxPinnedSkills: 1 },
      availableSkillIds: new Set(['skill-a', 'skill-b', 'skill-c']),
    });

    expect(pinned).toEqual(['skill-a']);
  });
});
