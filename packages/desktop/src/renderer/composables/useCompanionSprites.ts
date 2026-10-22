

const SPRITE_BASE = '/companion/sprites/Danganronpa_V3_Chiaki_Nanami_Bonus_Mode_Sprites';
const VOICE_BASE = '/companion/voices';

const pad = (n: number) => String(n).padStart(2, '0');
const spriteSrc = (n: number) => `${SPRITE_BASE}_${pad(n)}.webp`;
const voiceSrc = (n: number) => `${VOICE_BASE}/nanami_voice_${pad(n)}.wav`;

export const PHASE_SPRITE: Record<string, string> = {
  dormant: spriteSrc(15),
  idle: spriteSrc(1),
  thinking: spriteSrc(8),
  nudge: spriteSrc(5),
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
  nudge: voiceSrc(4),
};
