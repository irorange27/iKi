import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const RENDERER_SEAM = new URL(
  '../../../../packages/desktop/src/renderer/modules/chat/tool_payloads.ts',
  import.meta.url
);
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

    expect(specifiers).not.toContain('zod');
    for (const forbidden of SCHEMA_HEAVY_BACKEND) {
      expect(specifiers.filter(s => s === forbidden || s.startsWith(`${forbidden}/`))).toEqual([]);
    }
  });
});
