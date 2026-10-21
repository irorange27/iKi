import { describe, expect, it } from 'vitest';

import { normalizeAppConfig } from '@iki/backend/config/normalize';
import { createChatTurnPreparer } from '@iki/backend/turn_prep/turn_preparer';

// The affect/emotion guard that used to DERIVE `requireApproval` is gone
// (memory + affect subsystem removal). What remains is the explicit policy: a
// turn requires approval only when the caller says so. These assertions pin
// that the derivation cannot come back silently — a re-introduced guard would
// flip the unset case to true and fail here.
const prepare = (options: { requireApproval?: boolean; approvalPolicy?: string } = {}) => {
  const preparer = createChatTurnPreparer({
    getRuntimeConfig: () => ({
      autoApproveToolRequests: false,
      contextBudget: normalizeAppConfig({}).context,
    }),
    resolveSkillsSystemPrompt: async () => ({
      skillsSystemPrompt: '',
      usedSkills: [],
      skillMode: 'manual' as const,
    }),
    getAssistantProfileContextMessage: () => '',
  });

  return preparer.prepareChatTurn({
    providerType: 'openai',
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hello' }],
    tools: ['read_file'],
    ...options,
  });
};

describe('chat turn approval derivation', () => {
  it('requires approval only when the caller asks for it explicitly', async () => {
    expect((await prepare()).requireApproval).toBe(false);
    expect((await prepare({ requireApproval: true })).requireApproval).toBe(true);
  });

  it('lets an explicit rehydration value win regardless of the policy', async () => {
    expect(
      (await prepare({ requireApproval: false, approvalPolicy: 'always' })).requireApproval
    ).toBe(false);
  });
});
