import { describe, expect, it } from 'vitest';

import { resolveRequireApproval } from '@iki/backend/turn_prep/turn_preparer';

describe('resolveRequireApproval', () => {
  it('lets an explicit rehydration value win over an active guard derivation', () => {
    expect(
      resolveRequireApproval(false, true, { toolGuard: { requireApproval: true } })
    ).toBe(false);
    expect(resolveRequireApproval(true, false, null)).toBe(true);
  });

  it('keeps the affect-guard derivation authoritative when unset', () => {
    expect(
      resolveRequireApproval(undefined, true, { toolGuard: { requireApproval: true } })
    ).toBe(true);
    expect(
      resolveRequireApproval(undefined, true, { toolGuard: { requireApproval: false } })
    ).toBe(false);
    expect(resolveRequireApproval(undefined, false, { toolGuard: { requireApproval: true } })).toBe(
      false
    );
  });
});
