import { describe, expect, it, vi } from 'vitest';

import { createToolApprovalController } from '../../../../packages/desktop/src/renderer/modules/chat/tool_approval_controller';

type Part = Record<string, unknown>;

const createDeps = (approveToolResult: Promise<Record<string, unknown>> | Record<string, unknown>) => {
  const chat = {
    addToolApprovalResponse: vi.fn(),
    resumeStream: vi.fn(async () => undefined),
  };
  const transport = {
    expectFollowUpStream: vi.fn(),
    disarmFollowUpStream: vi.fn(),
    closeFollowUpStream: vi.fn(),
  };
  const approveTool = vi.fn(() => approveToolResult);
  const electronAPI = { chat: { approveTool } };

  const controller = createToolApprovalController({
    chat: chat as never,
    transport: transport as never,
    electronAPI: electronAPI as never,
  });

  return { controller, chat, transport, approveTool };
};

describe('tool_approval_controller', () => {
  it.each([{ approved: true }, { approved: false }])(
    'consumes the follow-up stream when the resumed turn blocked again ($approved)',
    async ({ approved }) => {
      const { controller, chat, transport } = createDeps({
        success: true,
        awaitingApproval: true,
        stopped: false,
      });

      await controller.handleToolApproval(
        { id: 'assistant_1', role: 'assistant', parts: [] } as never,
        { type: 'dynamic-tool', approvalId: 'aitxt_1' } as Part,
        approved
      );

      // The repeat-approval segment carries the next tool part + card on a
      // stream with no terminal chunk; it must be closed and consumed or the
      // turn stalls on an unread stream (the awaiting-forever regression).
      expect(transport.closeFollowUpStream).toHaveBeenCalledTimes(1);
      expect(chat.resumeStream).toHaveBeenCalledTimes(1);
      expect(chat.addToolApprovalResponse).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'aitxt_1', approved })
      );
    }
  );

  it('still consumes the follow-up stream when the resumed turn completed', async () => {
    const { controller, chat, transport } = createDeps({
      success: true,
      awaitingApproval: false,
      stopped: false,
    });

    await controller.handleToolApproval(
      { id: 'assistant_1', role: 'assistant', parts: [] } as never,
      { type: 'dynamic-tool', approvalId: 'aitxt_1' } as Part,
      true
    );

    expect(transport.closeFollowUpStream).toHaveBeenCalledTimes(1);
    expect(chat.resumeStream).toHaveBeenCalledTimes(1);
  });

  it('disarms the follow-up slot and does not resume when the approve IPC fails', async () => {
    const { controller, chat, transport } = createDeps({ success: false, error: 'boom' });

    await controller.handleToolApproval(
      { id: 'assistant_1', role: 'assistant', parts: [] } as never,
      { type: 'dynamic-tool', approvalId: 'aitxt_1' } as Part,
      true
    );

    expect(transport.disarmFollowUpStream).toHaveBeenCalledTimes(1);
    expect(chat.resumeStream).not.toHaveBeenCalled();
  });

  it('ignores double-clicks for the same approval', async () => {
    let resolveApproval: (value: Record<string, unknown>) => void = () => undefined;
    const { controller, approveTool } = createDeps(
      new Promise(resolve => {
        resolveApproval = resolve;
      })
    );

    const first = controller.handleToolApproval(
      { id: 'assistant_1', role: 'assistant', parts: [] } as never,
      { type: 'dynamic-tool', approvalId: 'aitxt_1' } as Part,
      true
    );
    await controller.handleToolApproval(
      { id: 'assistant_1', role: 'assistant', parts: [] } as never,
      { type: 'dynamic-tool', approvalId: 'aitxt_1' } as Part,
      true
    );
    resolveApproval({ success: true, awaitingApproval: false, stopped: false });
    await first;

    expect(approveTool).toHaveBeenCalledTimes(1);
  });
});
