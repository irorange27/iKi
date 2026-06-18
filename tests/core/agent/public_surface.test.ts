import { describe, expect, it } from 'vitest';

import * as currentAgentApi from '../../../src/core/agent';

describe('core agent public surface', () => {
  it('keeps the default barrel runner-first and excludes removed legacy agent exports', () => {
    expect(currentAgentApi).toHaveProperty('createSimpleAgentRunner');
    expect(currentAgentApi).toHaveProperty('SimpleAgentRunner');
    expect(currentAgentApi).toHaveProperty('getConversationRunnerConfig');

    expect(currentAgentApi).not.toHaveProperty('createSimpleConversationRunner');
    expect(currentAgentApi).not.toHaveProperty('SimpleConversationRunner');
    expect(currentAgentApi).not.toHaveProperty('SimpleAgent');
    expect(currentAgentApi).not.toHaveProperty('Agent');
    expect(currentAgentApi).not.toHaveProperty('createAgent');
    expect(currentAgentApi).not.toHaveProperty('getAgentConfig');
    expect(currentAgentApi).not.toHaveProperty('BaseAgent');
    expect(currentAgentApi).not.toHaveProperty('AgentMessageSchema');
    expect(currentAgentApi).not.toHaveProperty('AgentStateSchema');
    expect(currentAgentApi).not.toHaveProperty('AgentHookContextSchema');
  });
});
