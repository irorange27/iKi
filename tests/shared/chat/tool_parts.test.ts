import { describe, expect, it } from 'vitest';

import {
  getApprovalId,
  getToolInput,
  getToolName,
  isToolResultPart,
  normalizeDynamicToolPart,
} from '../../../src/shared/chat/tool_parts';

describe('tool_parts', () => {
  it('extracts approval ids from common fields', () => {
    expect(getApprovalId({ approvalId: 'approval_1' })).toBe('approval_1');
    expect(getApprovalId({ approval: { id: 'approval_2' } })).toBe('approval_2');
    expect(getApprovalId({ approval: { id: 123 } })).toBeNull();
  });

  it('uses fallback approval ids when normalizing approval-requested parts', () => {
    const normalized = normalizeDynamicToolPart(
      {
        type: 'dynamic-tool',
        toolCallId: 'call_1',
        toolName: 'web',
        state: 'approval-requested',
      },
      'fallback_call'
    );

    expect(normalized.approval?.id).toBe('call_1_approval');

    const normalizedWithApproval = normalizeDynamicToolPart(
      {
        type: 'dynamic-tool',
        toolCallId: 'call_2',
        toolName: 'web',
        state: 'approval-requested',
        approval: { id: 'approval_2' },
      },
      'fallback_call'
    );

    expect(normalizedWithApproval.approval?.id).toBe('approval_2');
  });

  it('classifies tool result parts based on state/output', () => {
    expect(
      isToolResultPart({
        type: 'dynamic-tool',
        toolCallId: 'tool_1',
        toolName: 'tool',
        state: 'approval-requested',
        approval: { id: 'approval_1' },
      })
    ).toBe(false);

    expect(
      isToolResultPart({
        type: 'dynamic-tool',
        toolCallId: 'tool_2',
        toolName: 'tool',
        state: 'output-available',
      })
    ).toBe(true);

    expect(
      isToolResultPart({
        type: 'tool-call',
        toolCallId: 'tool_3',
      })
    ).toBe(false);

    expect(
      isToolResultPart({
        type: 'tool-result',
        toolCallId: 'tool_4',
        output: { ok: true },
      })
    ).toBe(true);
  });

  it('unwraps ACP dynamic tool payloads into the actual tool name and args', () => {
    const part = {
      type: 'tool-call',
      toolCallId: 'tool_5',
      toolName: 'acp.acp_provider_agent_dynamic_tool',
      input: JSON.stringify({
        toolCallId: 'tool_5',
        toolName: 'write_file',
        args: {
          path: 'notes.md',
        },
      }),
    };

    expect(getToolName(part)).toBe('write_file');
    expect(getToolInput(part)).toEqual({
      path: 'notes.md',
    });
  });
});
