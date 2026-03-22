import { describe, expect, it } from 'vitest';

import { ShellExecutionTool } from '../../../src/core/tools/shell_tools';

describe('shell tool metadata', () => {
  it('is manual-only and always requires approval', () => {
    const tool = new ShellExecutionTool().toAgentTool();

    expect(tool.autoAllowed).toBe(false);
    expect(tool.needsApproval).toBe(true);
  });
});
