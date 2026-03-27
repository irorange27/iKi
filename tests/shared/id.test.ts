import { describe, expect, it, vi } from 'vitest';

import { createPrefixedId } from '../../src/shared/utils/id';

describe('createPrefixedId', () => {
  it('builds timestamped ids with the requested prefix and suffix length', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1774083600000);

    expect(createPrefixedId('workspace')).toMatch(/^workspace_1774083600000_[a-z0-9]{7}$/);
    expect(createPrefixedId('ui', { randomLength: 6 })).toMatch(/^ui_1774083600000_[a-z0-9]{6}$/);

    nowSpy.mockRestore();
  });
});
