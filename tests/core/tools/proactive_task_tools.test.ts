import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iki/backend/tasks/proactive_task_manager', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/tasks/proactive_task_manager')>();
  return {
    ...actual,
    createProactiveTask: vi.fn(),
    deleteProactiveTask: vi.fn(),
    listProactiveTaskRecords: vi.fn(),
    readProactiveTaskRecord: vi.fn(),
    updateProactiveTask: vi.fn(),
  };
});

import {
  createProactiveTask,
  deleteProactiveTask,
  readProactiveTaskRecord,
  updateProactiveTask,
} from '@iki/backend/tasks/proactive_task_manager';
import {
  DeleteProactiveTaskTool,
  WriteProactiveTaskTool,
} from '@iki/backend/tools/proactive_task_tools';
import { runWithToolRuntimeContext } from '@iki/core/tools/runtime_context';

describe('proactive task tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates proactive tasks with current-thread and current-model defaults', async () => {
    vi.mocked(createProactiveTask).mockReturnValue({ id: 'task_1' } as never);
    vi.mocked(readProactiveTaskRecord).mockReturnValue({
      id: 'task_1',
      name: 'Daily Gold',
    } as never);

    const tool = new WriteProactiveTaskTool();
    const result = await runWithToolRuntimeContext(
      {
        threadId: 'thread_current',
        conversationModel: {
          providerType: 'openai',
          providerId: 'provider_primary',
          model: 'gpt-4o-mini',
        },
      },
      async () =>
        await tool.execute({
          action: 'create',
          name: 'Daily Gold',
          prompt: 'Summarize the latest gold price in USD.',
          schedule: {
            kind: 'daily',
            time: '09:00',
            timezone: 'Asia/Shanghai',
          },
          toolMode: 'manual',
          tools: ['web', 'fetch'],
        })
    );

    expect(createProactiveTask).toHaveBeenCalledWith({
      name: 'Daily Gold',
      prompt: 'Summarize the latest gold price in USD.',
      enabled: undefined,
      notify: undefined,
      thread_id: 'thread_current',
      provider_type: 'openai',
      provider_id: 'provider_primary',
      model: 'gpt-4o-mini',
      schedule_type: 'cron',
      interval_minutes: 1440,
      cron_expression: '0 9 * * *',
      schedule_timezone: 'Asia/Shanghai',
      tool_mode: 'manual',
      tools: ['web', 'fetch'],
    });
    expect(result).toEqual({
      action: 'created',
      task: { id: 'task_1', name: 'Daily Gold' },
    });
  });

  it('updates proactive tasks by current name and keeps approval locked', async () => {
    vi.mocked(updateProactiveTask).mockReturnValue({ id: 'task_2' } as never);
    vi.mocked(readProactiveTaskRecord).mockReturnValue({
      id: 'task_2',
      name: 'Daily Gold',
    } as never);

    const tool = new WriteProactiveTaskTool();

    expect(tool.needsApproval).toBe(true);
    expect(tool.approvalMode).toBe('always');

    const result = await runWithToolRuntimeContext(
      {
        threadId: 'thread_current',
        conversationModel: {
          providerType: 'openai',
          providerId: 'provider_primary',
          model: 'gpt-4o-mini',
        },
      },
      async () =>
        await tool.execute({
          action: 'update',
          currentName: 'Daily Gold',
          delivery: 'specific_thread',
          threadId: 'thread_other',
          enabled: true,
        })
    );

    expect(updateProactiveTask).toHaveBeenCalledWith(
      { id: undefined, name: 'Daily Gold' },
      {
        enabled: true,
        thread_id: 'thread_other',
      }
    );
    expect(result).toEqual({
      action: 'updated',
      task: { id: 'task_2', name: 'Daily Gold' },
    });
  });

  it('deletes proactive tasks by name and marks deletion as always approval-gated', async () => {
    vi.mocked(deleteProactiveTask).mockReturnValue({
      deleted: true,
      taskId: 'task_3',
      taskName: 'Daily Gold',
    } as never);

    const tool = new DeleteProactiveTaskTool();

    expect(tool.needsApproval).toBe(true);
    expect(tool.approvalMode).toBe('always');

    await expect(tool.execute({ name: 'Daily Gold' })).resolves.toEqual({
      deleted: true,
      taskId: 'task_3',
      taskName: 'Daily Gold',
    });
  });
});
