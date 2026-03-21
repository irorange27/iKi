import { describe, expect, it } from 'vitest';

import { ShellExecutionTool } from '../../../src/core/tools/shell_tools';

describe('shell tool metadata', () => {
  it('is auto-eligible by default while still using conditional approval at execution time', () => {
    const tool = new ShellExecutionTool().toAgentTool();

    expect(tool.autoAllowed).toBe(true);
    expect(typeof tool.needsApproval).toBe('function');
  });
});
