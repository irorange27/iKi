import { z } from 'zod';

import { createLogger } from '../logger';

const toolJsonSchemaLogger = createLogger({ module: 'tool_json_schema' });

const createFallbackJsonSchema = (title?: string): Record<string, unknown> => ({
  type: 'object',
  ...(title ? { title } : {}),
  properties: {},
});

const isJsonSchemaObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const applyFallbackTitle = (
  schema: Record<string, unknown>,
  fallbackTitle?: string
): Record<string, unknown> => {
  if (!fallbackTitle || typeof schema.title === 'string') {
    return schema;
  }

  return {
    title: fallbackTitle,
    ...schema,
  };
};

export const zodSchemaToJsonSchema = (
  schema: z.ZodTypeAny | undefined,
  options: { title?: string } = {}
): Record<string, unknown> => {
  if (!schema) {
    return createFallbackJsonSchema(options.title);
  }

  try {
    const jsonSchema = z.toJSONSchema(schema, {
      target: 'draft-07',
      reused: 'inline',
      unrepresentable: 'any',
    });

    if (isJsonSchemaObject(jsonSchema)) {
      return applyFallbackTitle(jsonSchema, options.title);
    }
  } catch (error) {
    toolJsonSchemaLogger.event({
      level: 'warn',
      event: 'tool.schema.derive',
      outcome: 'failed',
      error,
      data: {
        title: options.title || null,
      },
    });
  }

  return createFallbackJsonSchema(options.title);
};
