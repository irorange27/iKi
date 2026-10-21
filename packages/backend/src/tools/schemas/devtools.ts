import { z } from 'zod';

import { toolCallDescriptionField } from './shared';

const elementSourceInputShape = {
  target: z
    .enum(['selected', 'hovered', 'selector', 'point'])
    .optional()
    .default('selected')
    .describe(
      'Which element to locate. `selected` = the element the user last clicked in the app (the recorder is installed on first use), `hovered` = the one under the pointer now, `selector` = the CSS selector given in `selector`, `point` = the viewport pixel given in `x`/`y` (use this to name the source behind something you can see in a screenshot).'
    ),
  selector: z
    .string()
    .min(1)
    .optional()
    .describe('CSS selector to locate; required when target is `selector`'),
  x: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Viewport x in CSS pixels; required when target is `point`'),
  y: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Viewport y in CSS pixels; required when target is `point`'),
  description: toolCallDescriptionField,
};

export const ElementSourceInputSchema = z.object(elementSourceInputShape);
