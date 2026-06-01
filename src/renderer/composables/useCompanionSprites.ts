/**
 * Maps iKi companion phases to Chiaki Nanami sprite indices.
 * Sprites are Danganronpa V3 bonus mode character portraits.
 *
 * Emotion tags (from character.yaml):
 *   01: neutral, calm    02: tired, yawning     03: pointing, guiding
 *   04: angry, pouting   05: happy, smiling      06: exhausted, drooling
 *   07: frowning, worried 08: pondering, curious  09: neutral, head tilt
 *   10: explaining        11: examining, gazing    12: uneasy, withdrawn
 *   13: very excited      14: pondering, frowning  15: sleepy, dozing
 *   16: sad, frustrated   17: warning, stopping    18: complaining
 *   19: puzzled, thinking 20: serious, cold        21: shy, blushing
 */

const SPRITE_BASE = '/companion/sprites/Danganronpa_V3_Chiaki_Nanami_Bonus_Mode_Sprites';
const VOICE_BASE = '/companion/voices';

const pad = (n: number) => String(n).padStart(2, '0');
const spriteSrc = (n: number) => `${SPRITE_BASE}_${pad(n)}.webp`;
const voiceSrc = (n: number) => `${VOICE_BASE}/nanami_voice_${pad(n)}.wav`;

export const PHASE_SPRITE: Record<string, string> = {
  dormant: spriteSrc(15),
  idle: spriteSrc(1),
  thinking: spriteSrc(8),
  clarify: spriteSrc(19),
  co_plan: spriteSrc(3),
  stabilize: spriteSrc(7),
  execute: spriteSrc(10),
  'nudge-success': spriteSrc(5),
  'nudge-error': spriteSrc(12),
};

/** Fallback when phase is unrecognized. */
export const DEFAULT_SPRITE = spriteSrc(1);

/** Idle variant sprites for random rotation (neutral poses). */
export const IDLE_VARIANTS = [spriteSrc(1), spriteSrc(9), spriteSrc(11)];

/** Deep-thinking sprite: shown when thinking > 10 s or tool calls > 2. */
export const DEEP_THINKING_SPRITE = spriteSrc(14);

/** Interaction reaction sprites. */
export const HOVER_SPRITE = spriteSrc(11);
export const CLICK_SPRITE = spriteSrc(13);

/** Emotion-driven idle variants: shown when affect is present but below intervention threshold. */
export const AFFECT_SAD_SPRITE = spriteSrc(16); // sad, frustrated
export const AFFECT_EXCITED_SPRITE = spriteSrc(13); // very excited
export const AFFECT_TIRED_SPRITE = spriteSrc(2); // tired, yawning

/** Voice clip per phase (sprite index N → voice index N-1). */
export const PHASE_VOICE: Record<string, string> = {
  dormant: voiceSrc(14),
  idle: voiceSrc(0),
  thinking: voiceSrc(7),
  clarify: voiceSrc(18),
  co_plan: voiceSrc(2),
  stabilize: voiceSrc(6),
  execute: voiceSrc(9),
  'nudge-success': voiceSrc(4),
  'nudge-error': voiceSrc(11),
};
