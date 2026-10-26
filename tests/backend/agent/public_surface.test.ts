import { describe, expect, it } from 'vitest';

import * as agentApi from '@iki/backend/agent';
import * as harnessApi from '@iki/backend/agent/harness';

describe('agent public surface', () => {
  it('does not re-export the tool registry; consumers import @iki/backend/tools directly', () => {
    expect(agentApi).not.toHaveProperty('defaultToolRegistry');
    expect(agentApi).not.toHaveProperty('registerStandardTools');
  });

  it('does not export the harness, the run tracker, or the turn driver', () => {
    expect(agentApi).not.toHaveProperty('startPiTurnHarness');
    expect(agentApi).not.toHaveProperty('TurnDriverHarness');
    expect(agentApi).not.toHaveProperty('createAgentRunTracker');
    expect(agentApi).not.toHaveProperty('AgentRunTracker');
  });

  it('reaches the harness entry point through the harness subpath', () => {
    expect(harnessApi).toHaveProperty('startPiTurnHarness');
  });
});
