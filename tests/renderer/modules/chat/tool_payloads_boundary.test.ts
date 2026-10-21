import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Boundary regression for P1 (renderer ships the backend tool-schema closure).
 *
 * These assertions fail on the pre-split wiring: the renderer's tool-payload
 * parsing lived behind `@iki/backend/message/tool_payloads`, which imports
 * `@iki/backend/tools/schemas` (zod + every tool schema, ~1.6 MB). The renderer
 * seam now imports the schemas-free `tool_payload_contracts` module instead.
 *
 * Static source assertions, same style as tests/backend/tools/schemas.test.ts —
 * they run without the bundler, so they catch the regression in `pnpm test`.
 * R5/R5b/R7 in .dependency-cruiser.cjs enforce the same rule on the graph.
 */

const RENDERER_SEAM = new URL(
  '../../../../packages/desktop/src/renderer/modules/chat/tool_payloads.ts',
  import.meta.url
);
// The module that carried the bad runtime import before the split.
const RENDERER_TOOL_CALLS = new URL(
  '../../../../packages/desktop/src/renderer/modules/chat/ui_message_tool_calls.ts',
  import.meta.url
);
const BACKEND_CONTRACTS = new URL(
  '../../../../packages/backend/src/message/tool_payload_contracts.ts',
  import.meta.url
);

const importSpecifiers = (url: URL): string[] =>
  Array.from(
    readFileSync(url, 'utf8').matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g),
    match => match[1]
  );

/** Backend modules whose runtime closure the renderer must never touch. */
const SCHEMA_HEAVY_BACKEND = [
  '@iki/backend/tools',
  '@iki/backend/provider',
  '@iki/backend/thread_session',
  '@iki/backend/db',
  '@iki/backend/agent',
];

describe('renderer tool-payload seam stays out of the schema closure', () => {
  it('does not import the schema-coupled backend tool_payloads module', () => {
    const specifiers = importSpecifiers(RENDERER_SEAM);

    expect(specifiers).toContain('@iki/backend/message/tool_payload_contracts');
    expect(specifiers.some(specifier => specifier.endsWith('message/tool_payloads'))).toBe(false);
  });

  it('keeps the schema-coupled import out of the chat modules that used to carry it', () => {
    // ui_message_tool_calls.ts is where the P1 defect lived: it did a runtime
    // `import { parseToolInput, parseToolOutput } from '@iki/backend/message/
    // tool_payloads'`, which pulled zod + every tool schema into the bundle.
    // Parsing now belongs to the seam above, so no chat module may re-add it.
    for (const specifier of importSpecifiers(RENDERER_TOOL_CALLS)) {
      expect(specifier.endsWith('message/tool_payloads')).toBe(false);
    }
  });

  it('imports no schema-heavy backend module at all', () => {
    const specifiers = [
      ...importSpecifiers(RENDERER_SEAM),
      ...importSpecifiers(RENDERER_TOOL_CALLS),
    ];

    for (const forbidden of SCHEMA_HEAVY_BACKEND) {
      expect(specifiers.filter(s => s === forbidden || s.startsWith(`${forbidden}/`))).toEqual([]);
    }
  });
});

describe('backend tool_payload_contracts stays schemas-free', () => {
  it('is the module the renderer may depend on', () => {
    const specifiers = importSpecifiers(BACKEND_CONTRACTS);

    // zod is the whole cost of the closure: it must not appear here.
    expect(specifiers).not.toContain('zod');
    for (const forbidden of SCHEMA_HEAVY_BACKEND) {
      expect(specifiers.filter(s => s === forbidden || s.startsWith(`${forbidden}/`))).toEqual([]);
    }
  });
});
