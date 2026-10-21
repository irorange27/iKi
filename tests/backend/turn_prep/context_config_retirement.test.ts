/**
 * §C-F1 / task-7 — the three retired context budgets must be GONE, not idle.
 *
 * `maxRecentTokens` / `maxMessageTokens` / `maxSummaryTokens` had zero
 * consumers: writing them into the config file changed nothing on the wire.
 * That is a lying configuration surface, so the audit's option A declared the
 * capability retired. These assertions are the retirement proof — each one
 * fails on the pre-retirement code (where the keys existed and the derivation
 * rescaled them) and passes only when the keys are gone from every layer.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_APP_CONFIG, mergeAppConfig } from '@iki/backend/config/defaults';
import { AppConfigSchema } from '@iki/backend/config/schema';
import { deriveModelAwareContextConfig } from '@iki/backend/turn_prep/context_budget';

// tests/backend/turn_prep/<this file> → repo root
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BACKEND_SRC = path.join(REPO_ROOT, 'packages/backend/src');

const RETIRED_CONTEXT_KEYS = ['maxRecentTokens', 'maxMessageTokens', 'maxSummaryTokens'] as const;

/** Context budgets that DO have a consumer — `context_blocks.ts` clips to them. */
const LIVE_CONTEXT_KEYS = ['enabled', 'maxIdentityTokens', 'maxSkillTokens'] as const;

const listSourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap(entry => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return listSourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });

describe('retired context budgets (C-F1 option A)', () => {
  it('are absent from the default config object', () => {
    for (const key of RETIRED_CONTEXT_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(DEFAULT_APP_CONFIG.context, key)).toBe(false);
    }
    // The live budget face is exactly what has a consumer: no dead knobs, and
    // no silent loss of the two clippers that actually run.
    expect(Object.keys(DEFAULT_APP_CONFIG.context).sort()).toEqual([...LIVE_CONTEXT_KEYS].sort());
  });

  it('are rejected by the config schema rather than silently accepted', () => {
    for (const key of RETIRED_CONTEXT_KEYS) {
      const parsed = AppConfigSchema.parse({ context: { [key]: 9999 } });
      expect(Object.prototype.hasOwnProperty.call(parsed.context, key)).toBe(false);
    }
    // A live budget still round-trips — the schema was not gutted.
    expect(AppConfigSchema.parse({ context: { maxSkillTokens: 999 } }).context.maxSkillTokens).toBe(
      999
    );
  });

  it('never survive a config merge (no compatibility read, even from a stale file)', () => {
    const merged = mergeAppConfig({
      context: {
        maxRecentTokens: 9999,
        maxMessageTokens: 9999,
        maxSummaryTokens: 9999,
        maxSkillTokens: 777,
      },
    } as never);

    for (const key of RETIRED_CONTEXT_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(merged.context, key)).toBe(false);
    }
    expect(merged.context.maxSkillTokens).toBe(777);
  });

  it('do not come back through the model-aware derivation', () => {
    const capability = {
      providerType: 'openai',
      providerKey: 'openai',
      modelId: 'gpt-small',
      displayName: 'GPT Small',
      contextWindow: 4096,
      maxInputTokens: 4096,
      maxOutputTokens: 1024,
      supportsToolCalls: true,
      supportsReasoning: false,
      source: 'models.dev' as const,
    };
    const derived = deriveModelAwareContextConfig(DEFAULT_APP_CONFIG.context, capability);

    for (const key of RETIRED_CONTEXT_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(derived, key)).toBe(false);
    }
    // The derivation still owns the live decision: output cap from capability.
    expect(derived.maxOutputTokens).toBe(1024);
  });

  it('appear nowhere in the backend source (the grep, made permanent)', () => {
    const offenders = listSourceFiles(BACKEND_SRC)
      .filter(file => {
        const source = readFileSync(file, 'utf8');
        return RETIRED_CONTEXT_KEYS.some(key => source.includes(key));
      })
      .map(file => path.relative(REPO_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
