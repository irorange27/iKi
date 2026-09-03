import { z } from 'zod';

import { DEFAULT_FETCH_MAX_CHARS, DEFAULT_SEARCH_RESULT_LIMIT, toolCallDescriptionField, uiSchema } from './shared';

const webInputFields = {
  query: z.string().min(1).describe('Search query text'),
  limit: z.number().int().describe('Maximum number of search results'),
};

const fetchInputFields = {
  url: z.string().url().describe('HTTP/HTTPS URL to fetch'),
  maxChars: z
    .number()
    .int()
    .describe('Maximum number of characters to return from fetched content'),
};

// ---------------------------------------------------------------------------
// Web tool schemas
// ---------------------------------------------------------------------------

const webToolInputShape = {
  query: webInputFields.query,
  limit: webInputFields.limit.optional().default(DEFAULT_SEARCH_RESULT_LIMIT),
  description: toolCallDescriptionField,
};

export const WebToolInputSchema = z.object(webToolInputShape);
export const WebToolInputSchemaUi = uiSchema(webToolInputShape);

// ---------------------------------------------------------------------------
// Fetch tool schemas
// ---------------------------------------------------------------------------

const fetchToolInputShape = {
  url: fetchInputFields.url,
  maxChars: fetchInputFields.maxChars.optional().default(DEFAULT_FETCH_MAX_CHARS),
  description: toolCallDescriptionField,
};

export const FetchToolInputSchema = z.object(fetchToolInputShape);
export const FetchToolInputSchemaUi = uiSchema(fetchToolInputShape);
