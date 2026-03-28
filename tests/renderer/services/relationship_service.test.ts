// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { relationshipService } from '../../../src/renderer/services/relationship_service';

describe('relationshipService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    vi.restoreAllMocks();
  });

  it('delegates relationship overview requests when the bridge is available', async () => {
    const overview = { owner: { owner_label: 'Nina', relationship_to_owner: 'owner' } } as const;
    const getOverview = vi.fn(async () => overview);

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        relationship: {
          getOverview,
        },
      },
    });

    expect(await relationshipService.getOverview()).toBe(overview);
    expect(getOverview).toHaveBeenCalledWith(8);
  });

  it('throws a clear error when the relationship bridge is missing', async () => {
    await expect(relationshipService.getOverview()).rejects.toThrow(
      'window.electronAPI.relationship.getOverview is missing'
    );
  });
});
