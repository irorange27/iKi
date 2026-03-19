import { describe, expect, it } from 'vitest';

import { shouldGuardTools, type AffectToolGuardConfig } from '../../../src/core/emotion/affect_policy';
import type { AffectState } from '../../../src/core/emotion/affect_state';

const baseConfig: AffectToolGuardConfig = {
  enabled: true,
  minConfidence: 0.6,
  minArousal: 0.6,
  maxValence: -0.2,
  requireApproval: true,
  disableAutoTools: false,
};

const makeState = (overrides: Partial<AffectState>): AffectState => ({
  label: 'anger',
  confidence: 0.7,
  valence: -0.5,
  arousal: 0.7,
  emotions: [{ label: 'anger', score: 0.7 }],
  sampleCount: 3,
  windowSize: 5,
  startAt: '2026-03-18T10:00:00Z',
  endAt: '2026-03-18T10:05:00Z',
  ageMinutes: 1,
  windowMinutes: 5,
  ...overrides,
});

describe('shouldGuardTools', () => {
  it('returns false when disabled', () => {
    expect(shouldGuardTools(makeState({}), { ...baseConfig, enabled: false })).toBe(false);
  });

  it('requires arousal and valence', () => {
    expect(shouldGuardTools(makeState({ arousal: undefined }), baseConfig)).toBe(false);
    expect(shouldGuardTools(makeState({ valence: undefined }), baseConfig)).toBe(false);
  });

  it('returns false when thresholds are not met', () => {
    expect(shouldGuardTools(makeState({ confidence: 0.4 }), baseConfig)).toBe(false);
    expect(shouldGuardTools(makeState({ arousal: 0.4 }), baseConfig)).toBe(false);
    expect(shouldGuardTools(makeState({ valence: -0.05 }), baseConfig)).toBe(false);
  });

  it('returns true when thresholds are satisfied', () => {
    expect(shouldGuardTools(makeState({}), baseConfig)).toBe(true);
  });
});
