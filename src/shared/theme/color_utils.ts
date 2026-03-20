const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

type Rgb = {
  r: number;
  g: number;
  b: number;
};

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const expandShortHex = (value: string): string =>
  value
    .split('')
    .map(char => `${char}${char}`)
    .join('');

export const normalizeHexColor = (value: string): string => {
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    throw new Error(`Invalid hex color: ${value}`);
  }
  const hex = trimmed.slice(1);
  return `#${(hex.length === 3 ? expandShortHex(hex) : hex).toLowerCase()}`;
};

export const hexToRgb = (value: string): Rgb => {
  const normalized = normalizeHexColor(value).slice(1);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
};

export const rgbToHex = ({ r, g, b }: Rgb): string => {
  const toHex = (channel: number) => clampByte(channel).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export const mixHexColors = (left: string, right: string, ratioRight: number): string => {
  const leftRgb = hexToRgb(left);
  const rightRgb = hexToRgb(right);
  const ratio = Math.max(0, Math.min(1, ratioRight));

  return rgbToHex({
    r: leftRgb.r * (1 - ratio) + rightRgb.r * ratio,
    g: leftRgb.g * (1 - ratio) + rightRgb.g * ratio,
    b: leftRgb.b * (1 - ratio) + rightRgb.b * ratio,
  });
};

export const withAlpha = (value: string, alpha: number): string => {
  const { r, g, b } = hexToRgb(value);
  const normalizedAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
};

export const toRgbTuple = (value: string): string => {
  const { r, g, b } = hexToRgb(value);
  return `${r}, ${g}, ${b}`;
};

const toLinearChannel = (channel: number): number => {
  const normalized = channel / 255;
  if (normalized <= 0.03928) return normalized / 12.92;
  return ((normalized + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (value: string): number => {
  const { r, g, b } = hexToRgb(value);
  return 0.2126 * toLinearChannel(r) + 0.7152 * toLinearChannel(g) + 0.0722 * toLinearChannel(b);
};

export const readableTextColor = (
  background: string,
  darkText = '#111827',
  lightText = '#ffffff'
): string => (relativeLuminance(background) > 0.55 ? darkText : lightText);
