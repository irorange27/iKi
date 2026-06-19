import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iki/backend/awaiters/awaiter_manager', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/awaiters/awaiter_manager')>();
  return {
    ...actual,
    createAwaiter: vi.fn(),
    deleteAwaiter: vi.fn(),
    readAwaiterRecord: vi.fn(),
    updateAwaiter: vi.fn(),
  };
});

import {
  createAwaiter,
  deleteAwaiter,
  readAwaiterRecord,
  updateAwaiter,
} from '@iki/backend/awaiters/awaiter_manager';
import {
  DeleteAwaiterTool,
  WriteAwaiterTool,
} from '@iki/backend/tools/awaiter_tools';
import { runWithToolRuntimeContext } from '@iki/backend/tools/runtime_context';

describe('awaiter tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates awaiters with current-thread, current-model, and origin-run defaults', async () => {
    vi.mocked(createAwaiter).mockReturnValue({ id: 'awaiter_1' } as never);
    vi.mocked(readAwaiterRecord).mockReturnValue({
      id: 'awaiter_1',
      title: 'Resume Draft',
    } as never);

    const tool = new WriteAwaiterTool();

    expect(tool.needsApproval).toBe(true);
    expect(tool.approvalMode).toBe('always');

    const result = await runWithToolRuntimeContext(
      {
        runId: 'run_current',
        threadId: 'thread_current',
        conversationModel: {
          providerType: 'openai',
          providerId: 'provider_primary',
          model: 'gpt-5.4',
        },
      },
      async () =>
        await tool.execute({
          action: 'create',
          title: 'Resume Draft',
          instruction: 'Continue the draft tomorrow morning.',
          trigger: {
            kind: 'time_after',
            delayMinutes: 45,
          },
          notify: true,
        })
    );

    expect(createAwaiter).toHaveBeenCalledWith({
      title: 'Resume Draft',
      instruction: 'Continue the draft tomorrow morning.',
      thread_id: 'thread_current',
      notify: true,
      origin_run_id: 'run_current',
      resume_context_json:
        '{"createdFromRunId":"run_current","createdFromThreadId":"thread_current"}',
      trigger: {
        kind: 'time_after',
        delay_minutes: 45,
      },
      provider_type: 'openai',
      provider_id: 'provider_primary',
      model: 'gpt-5.4',
    });
    expect(result).toEqual({
      action: 'created',
      awaiter: { id: 'awaiter_1', title: 'Resume Draft' },
    });
  });

  it('updates awaiters by current title without requiring a current thread when threadId is omitted', async () => {
    vi.mocked(updateAwaiter).mockReturnValue({ id: 'awaiter_2' } as never);
    vi.mocked(readAwaiterRecord).mockReturnValue({
      id: 'awaiter_2',
      title: 'Resume Draft',
    } as never);

    const tool = new WriteAwaiterTool();

    const result = await runWithToolRuntimeContext({}, async () =>
      await tool.execute({
        action: 'update',
        currentTitle: 'Resume Draft',
        notify: false,
        trigger: {
          kind: 'time_at',
          at: '2026-04-24T01:00:00.000Z',
        },
      })
    );

    expect(updateAwaiter).toHaveBeenCalledWith(
      { id: undefined, title: 'Resume Draft' },
      {
        notify: false,
        trigger: {
          kind: 'time_at',
          at: '2026-04-24T01:00:00.000Z',
        },
      }
    );
    expect(result).toEqual({
      action: 'updated',
      awaiter: { id: 'awaiter_2', title: 'Resume Draft' },
    });
  });

  it('preserves the existing awaiter model settings on partial model updates instead of drifting to the current chat model', async () => {
    vi.mocked(updateAwaiter).mockReturnValue({ id: 'awaiter_9' } as never);
    vi.mocked(readAwaiterRecord)
      .mockReturnValueOnce({
        id: 'awaiter_9',
        title: 'Resume Draft',
        provider_type: 'deepseek',
        provider_id: 'provider_existing',
        model: 'deepseek-chat',
      } as never)
      .mockReturnValueOnce({
        id: 'awaiter_9',
        title: 'Resume Draft',
        provider_type: 'deepseek',
        provider_id: null,
        model: 'deepseek-chat',
      } as never);

    const tool = new WriteAwaiterTool();

    const result = await runWithToolRuntimeContext(
      {
        conversationModel: {
          providerType: 'openai',
          providerId: 'provider_primary',
          model: 'gpt-5.4',
        },
      },
      async () =>
        await tool.execute({
          action: 'update',
          id: 'awaiter_9',
          providerId: '   ',
        })
    );

    expect(updateAwaiter).toHaveBeenCalledWith(
      { id: 'awaiter_9', title: undefined },
      {
        provider_type: 'deepseek',
        provider_id: null,
        model: 'deepseek-chat',
      }
    );
    expect(result).toEqual({
      action: 'updated',
      awaiter: {
        id: 'awaiter_9',
        title: 'Resume Draft',
        provider_type: 'deepseek',
        provider_id: null,
        model: 'deepseek-chat',
      },
    });
  });

  it('deletes awaiters by title and keeps deletion approval-gated', async () => {
    vi.mocked(deleteAwaiter).mockReturnValue({
      deleted: true,
      awaiterId: 'awaiter_3',
      awaiterTitle: 'Resume Draft',
    } as never);

    const tool = new DeleteAwaiterTool();

    expect(tool.needsApproval).toBe(true);
    expect(tool.approvalMode).toBe('always');

    await expect(tool.execute({ title: 'Resume Draft' })).resolves.toEqual({
      deleted: true,
      awaiterId: 'awaiter_3',
      awaiterTitle: 'Resume Draft',
    });
  });
});
