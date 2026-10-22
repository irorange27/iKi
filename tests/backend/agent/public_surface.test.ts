import { describe, expect, it } from 'vitest';

import * as agentApi from '@iki/backend/agent';
import * as harnessApi from '@iki/backend/agent/harness';

describe('agent public surface', () => {
  it('re-exports the tool registry and schemas the agent layer is built from', () => {
    expect(agentApi).toHaveProperty('defaultToolRegistry');
    expect(agentApi).toHaveProperty('registerStandardTools');
    expect(agentApi).toHaveProperty('AgentConfigSchema');
    expect(agentApi).toHaveProperty('AgentToolSchema');
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
