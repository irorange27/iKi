import { describe, expect, it } from 'vitest';

import {
  applyToolApprovalPolicy,
  applyToolApprovalPolicyList,
} from '@iki/backend/utils/tool_approval';

describe('tool approval policy helpers', () => {
  it('preserves approval requirements when auto-approve is disabled', () => {
    const tool = { name: 'shell', needsApproval: true };

    expect(
      applyToolApprovalPolicy(tool, {
        autoApproveToolRequests: false,
      })
    ).toBe(tool);
  });

  it('forces approval-gated tools to manual-free execution when auto-approve is enabled', () => {
    expect(
      applyToolApprovalPolicy(
        { name: 'shell', needsApproval: true },
        {
          autoApproveToolRequests: true,
        }
      )
    ).toEqual({
      name: 'shell',
      needsApproval: false,
    });
  });

  it('does not downgrade tools with locked approval mode', () => {
    expect(
      applyToolApprovalPolicy(
        { name: 'write_personal_skill', needsApproval: true, approvalMode: 'always' },
        {
          autoApproveToolRequests: true,
        }
      )
    ).toEqual({
      name: 'write_personal_skill',
      needsApproval: true,
      approvalMode: 'always',
    });
  });

  it('updates tool metadata lists without touching already-safe tools', () => {
    expect(
      applyToolApprovalPolicyList(
        [
          { name: 'shell', needsApproval: true },
          { name: 'web', needsApproval: false },
        ],
        {
          autoApproveToolRequests: true,
        }
      )
    ).toEqual([
      { name: 'shell', needsApproval: false },
      { name: 'web', needsApproval: false },
    ]);
  });
});
