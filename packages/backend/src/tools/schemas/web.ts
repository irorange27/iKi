import { z } from 'zod';

import {
  DEFAULT_FETCH_MAX_CHARS,
  DEFAULT_SEARCH_RESULT_LIMIT,
  toolCallDescriptionField,
} from './shared';

export const WebToolInputSchema = z.object({
  query: z.string().min(1).describe('Search query text'),
  limit: z
    .number()
    .int()
    .describe('Maximum number of search results')
    .optional()
    .default(DEFAULT_SEARCH_RESULT_LIMIT),
  description: toolCallDescriptionField,
});

export const FetchToolInputSchema = z.object({
  url: z.string().url().describe('HTTP/HTTPS URL to fetch'),
  maxChars: z
    .number()
    .int()
    .describe('Maximum number of characters to return from fetched content')
    .optional()
    .default(DEFAULT_FETCH_MAX_CHARS),
  description: toolCallDescriptionField,
});
