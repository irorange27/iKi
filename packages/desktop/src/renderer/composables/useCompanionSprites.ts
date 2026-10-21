

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

export const DEFAULT_SPRITE = spriteSrc(1);

export const IDLE_VARIANTS = [spriteSrc(1), spriteSrc(9), spriteSrc(11)];

export const DEEP_THINKING_SPRITE = spriteSrc(14);

export const HOVER_SPRITE = spriteSrc(11);
export const CLICK_SPRITE = spriteSrc(13);

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
