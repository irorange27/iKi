import { describe, expect, it } from 'vitest';

import { ShellExecutionTool } from '../../../src/core/tools/shell_tools';

describe('shell tool metadata', () => {
  it('is auto-eligible and always requires approval', () => {
    const tool = new ShellExecutionTool().toAgentTool();

    expect(tool.autoAllowed).toBe(true);
    expect(tool.needsApproval).toBe(true);
  });
});
