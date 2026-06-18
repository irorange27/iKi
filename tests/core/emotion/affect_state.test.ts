import { describe, expect, it } from 'vitest';

import {
  buildAffectSystemMessage,
  computeAffectState,
  parseEmotionPayload,
  type AffectConfig,
  type EmotionSample,
} from '@iki/core/emotion/affect_state';

const baseConfig: AffectConfig = {
  enabled: true,
  injectToSystemPrompt: true,
  minConfidence: 0.1,
  minSampleCount: 2,
  windowSize: 5,
  halfLifeMinutes: 60,
  maxAgeMinutes: 180,
  includeNeutral: false,
};

const makeSample = (overrides: Partial<EmotionSample>): EmotionSample => ({
  emotion: {
    label: 'joy',
    confidence: 0.8,
    valence: 0.6,
    arousal: 0.4,
  },
  timestamp: new Date('2026-03-18T11:00:00Z'),
  ...overrides,
});

describe('parseEmotionPayload', () => {
  it('returns null on invalid JSON', () => {
    expect(parseEmotionPayload('not-json')).toBeNull();
  });

  it('parses a valid payload', () => {
    const payload = parseEmotionPayload(
      JSON.stringify({
        label: 'joy',
        confidence: 0.77,
        valence: 0.4,
        arousal: 0.2,
        emotions: [{ label: 'joy', score: 0.77 }],
      })
    );

    expect(payload?.label).toBe('joy');
    expect(payload?.confidence).toBeCloseTo(0.77, 2);
    expect(payload?.valence).toBeCloseTo(0.4, 2);
    expect(payload?.arousal).toBeCloseTo(0.2, 2);
    expect(payload?.emotions?.[0].label).toBe('joy');
  });
});

describe('computeAffectState', () => {
  it('returns null when config is disabled', () => {
    const state = computeAffectState([makeSample({})], { ...baseConfig, enabled: false });
    expect(state).toBeNull();
  });

  it('requires minimum samples', () => {
    const now = new Date('2026-03-18T12:00:00Z');
    const samples = [makeSample({})];
    const state = computeAffectState(
      samples,
      { ...baseConfig, minSampleCount: 2 },
      now
    );
    expect(state).toBeNull();
  });

  it('computes weighted affect state with decay', () => {
    const now = new Date('2026-03-18T12:00:00Z');
    const samples: EmotionSample[] = [
      makeSample({
        emotion: {
          label: 'joy',
          confidence: 0.8,
          valence: 0.6,
          arousal: 0.4,
        },
        timestamp: new Date('2026-03-18T11:00:00Z'),
      }),
      makeSample({
        emotion: {
          label: 'sadness',
          confidence: 0.7,
          valence: -0.6,
          arousal: 0.3,
        },
        timestamp: new Date('2026-03-18T11:30:00Z'),
      }),
    ];

    const state = computeAffectState(samples, baseConfig, now);
    expect(state?.label).toBe('sadness');
    expect(state?.confidence).toBeCloseTo(0.74, 2);
    expect(state?.valence).toBeCloseTo(-0.06, 2);
    expect(state?.arousal).toBeCloseTo(0.34, 2);
    expect(state?.emotions?.[0].label).toBe('sadness');
  });

  it('excludes neutral signals when configured', () => {
    const now = new Date('2026-03-18T12:00:00Z');
    const samples = [
      makeSample({
        emotion: {
          label: 'neutral',
          confidence: 0.9,
        },
        timestamp: new Date('2026-03-18T11:45:00Z'),
      }),
    ];

    const state = computeAffectState(
      samples,
      { ...baseConfig, minSampleCount: 1, includeNeutral: false },
      now
    );
    expect(state).toBeNull();
  });
});

describe('buildAffectSystemMessage', () => {
  it('includes label and confidence', () => {
    const now = new Date('2026-03-18T12:00:00Z');
    const state = computeAffectState(
      [
        makeSample({
          emotion: {
            label: 'anger',
            confidence: 0.8,
            valence: -0.7,
            arousal: 0.6,
          },
          timestamp: new Date('2026-03-18T11:50:00Z'),
        }),
        makeSample({
          emotion: {
            label: 'anger',
            confidence: 0.7,
            valence: -0.6,
            arousal: 0.5,
          },
          timestamp: new Date('2026-03-18T11:55:00Z'),
        }),
      ],
      { ...baseConfig, minSampleCount: 2 },
      now
    );

    expect(state).not.toBeNull();
    if (!state) {
      throw new Error('Expected affect state to be present.');
    }
    const message = buildAffectSystemMessage(state);
    expect(message).toContain('primary=anger');
    expect(message).toContain('confidence');
  });
});
