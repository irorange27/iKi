import { describe, expect, it } from 'vitest';

import { resolveThreadWorkMode, parseApprovalPolicy } from '../../../packages/backend/src/workspaces/thread_mode';

describe('resolveThreadWorkMode', () => {
  it('uses the explicit metadata mode when present', () => {
    expect(resolveThreadWorkMode({ metadata: '{"mode":"work"}' })).toBe('work');
    expect(resolveThreadWorkMode({ metadata: '{"mode":"chat"}', workspace_id: 'ws_user' })).toBe(
      'chat'
    );
  });

  it('classifies legacy threads by their workspace binding', () => {
    expect(resolveThreadWorkMode({ workspace_id: 'ws_user_folder' })).toBe('work');
    expect(resolveThreadWorkMode({ workspace_id: 'workspace_thread_abc' })).toBe('chat');
    expect(resolveThreadWorkMode({ workspace_id: 'workspace_wt_abc' })).toBe('chat');
    expect(resolveThreadWorkMode({ workspace_id: '' })).toBe('chat');
    expect(resolveThreadWorkMode(null)).toBe('chat');
  });

  it('survives malformed metadata', () => {
    expect(resolveThreadWorkMode({ metadata: 'not-json', workspace_id: 'ws_user' })).toBe('work');
  });
});

describe('approval policy parsing', () => {
  it.each(['never', 'always', 'askRisky', 'trustWorkspace'] as const)('round-trips %s', policy => {
    expect(parseApprovalPolicy(policy)).toBe(policy);
    expect(parseApprovalPolicy(policy.toUpperCase())).toBe(policy);
  });
});
