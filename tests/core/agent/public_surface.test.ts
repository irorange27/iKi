import { describe, expect, it } from 'vitest';

import * as currentAgentApi from '@iki/core/agent';

describe('core agent public surface', () => {
  it('exports types, schemas, config, and plan but not implementation runners', () => {
    expect(currentAgentApi).toHaveProperty('AgentConfigSchema');
    expect(currentAgentApi).toHaveProperty('AgentToolSchema');
    expect(currentAgentApi).not.toHaveProperty('createPlanThenExecutePrepareStep');
    expect(currentAgentApi).not.toHaveProperty('composePrepareSteps');

    // Implementation runners moved to @iki/backend/agent/runners/
    expect(currentAgentApi).not.toHaveProperty('createSimpleAgentRunner');
    expect(currentAgentApi).not.toHaveProperty('SimpleAgentRunner');
    expect(currentAgentApi).not.toHaveProperty('createAgentRunTracker');
    expect(currentAgentApi).not.toHaveProperty('AgentRunTracker');
    expect(currentAgentApi).not.toHaveProperty('ClaudeCodeRunner');
    expect(currentAgentApi).not.toHaveProperty('createClaudeCodeRunner');

    // Legacy agent exports removed
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
