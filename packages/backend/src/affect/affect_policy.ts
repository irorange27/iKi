import type { AffectState } from './affect_state';

export type AffectToolGuardConfig = {
  enabled: boolean;
  minConfidence: number;
  minArousal: number;
  maxValence: number;
  requireApproval: boolean;
  disableAutoTools: boolean;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const shouldGuardTools = (
  state: AffectState | null | undefined,
  config: AffectToolGuardConfig | null | undefined
): boolean => {
  if (!config?.enabled) return false;
  if (!state) return false;

  const confidence = clamp(state.confidence ?? 0, 0, 1);
  if (confidence < config.minConfidence) return false;

  if (typeof state.arousal !== 'number' || typeof state.valence !== 'number') {
    return false;
  }

  if (state.arousal < config.minArousal) return false;
  if (state.valence > config.maxValence) return false;

  return true;
};
