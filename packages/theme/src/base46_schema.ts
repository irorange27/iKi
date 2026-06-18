import { z } from 'zod';
import type { Base46ThemeDocument, Base46ThemePresetInput } from './types';

const hexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);

const Base30Schema = z
  .object({
    white: hexColor,
    black: hexColor,
    darker_black: hexColor,
    black2: hexColor.optional(),
    one_bg: hexColor,
    one_bg2: hexColor,
    one_bg3: hexColor.optional(),
    statusline_bg: hexColor.optional(),
    lightbg: hexColor.optional(),

    grey: hexColor,
    grey_fg: hexColor.optional(),
    grey_fg2: hexColor.optional(),
    light_grey: hexColor,
    line: hexColor,

    red: hexColor,
    baby_pink: hexColor.optional(),
    pink: hexColor.optional(),
    green: hexColor,
    vibrant_green: hexColor.optional(),
    nord_blue: hexColor.optional(),
    blue: hexColor,
    yellow: hexColor,
    sun: hexColor.optional(),
    purple: hexColor.optional(),
    dark_purple: hexColor.optional(),
    teal: hexColor.optional(),
    orange: hexColor.optional(),
    cyan: hexColor.optional(),

    pmenu_bg: hexColor.optional(),
    folder_bg: hexColor.optional(),
  })
  .loose();

const Base16Schema = z
  .object({
    base00: hexColor,
    base01: hexColor,
    base02: hexColor,
    base03: hexColor,
    base04: hexColor,
    base05: hexColor,
    base06: hexColor,
    base07: hexColor,
    base08: hexColor,
    base09: hexColor,
    base0A: hexColor,
    base0B: hexColor,
    base0C: hexColor,
    base0D: hexColor,
    base0E: hexColor,
    base0F: hexColor,
  })
  .loose();

export const Base46ThemeDocumentSchema = z
  .object({
    name: z.string().trim().min(1),
    type: z.enum(['light', 'dark']),
    base_30: Base30Schema,
    base_16: Base16Schema,
  })
  .passthrough();

export const Base46ThemePresetInputSchema = z
  .object({
    label: z.string().trim().min(1),
    light: Base46ThemeDocumentSchema.optional(),
    dark: Base46ThemeDocumentSchema.optional(),
  })
  .refine(value => Boolean(value.light || value.dark), {
    message: 'Base46 preset must define at least one theme variant.',
  })
  .refine(value => !value.light || value.light.type === 'light', {
    message: 'Light variant must have type "light".',
    path: ['light', 'type'],
  })
  .refine(value => !value.dark || value.dark.type === 'dark', {
    message: 'Dark variant must have type "dark".',
    path: ['dark', 'type'],
  });

export const parseBase46ThemeDocument = (raw: unknown): Base46ThemeDocument =>
  Base46ThemeDocumentSchema.parse(raw) as Base46ThemeDocument;

export const parseBase46ThemePresetInput = (raw: unknown): Base46ThemePresetInput =>
  Base46ThemePresetInputSchema.parse(raw) as Base46ThemePresetInput;
