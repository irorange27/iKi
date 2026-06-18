import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iki/backend/db/thread_todos', () => ({
  writeThreadTodoPlan: vi.fn(),
}));

vi.mock('@iki/core/tools/runtime_context', () => ({
  getToolRuntimeContext: vi.fn(),
}));

import { writeThreadTodoPlan } from '@iki/backend/db/thread_todos';
import { getToolRuntimeContext } from '@iki/core/tools/runtime_context';
import { TodoTool } from '@iki/backend/tools/task_plan_tools';

describe('TodoTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes the thread-scoped execution plan and returns rendered progress data', async () => {
    vi.mocked(getToolRuntimeContext).mockReturnValue({
      threadId: 'thread_1',
      availableSkillIds: [],
    });
    vi.mocked(writeThreadTodoPlan).mockReturnValue({
      thread_id: 'thread_1',
      items: [
        { id: '1', text: 'Inspect current code', status: 'completed' },
        { id: '2', text: 'Implement fix', status: 'in_progress' },
      ],
      created_at: '2026-03-30T00:00:00.000Z',
      updated_at: '2026-03-30T00:01:00.000Z',
    });

    const tool = new TodoTool();
    const result = await tool.execute({
      items: [
        { id: '1', text: 'Inspect current code', status: 'completed' },
        { id: '2', text: 'Implement fix', status: 'in_progress' },
      ],
      description: 'Track the current execution plan.',
    });

    expect(writeThreadTodoPlan).toHaveBeenCalledWith({
      threadId: 'thread_1',
      items: [
        { id: '1', text: 'Inspect current code', status: 'completed' },
        { id: '2', text: 'Implement fix', status: 'in_progress' },
      ],
    });
    expect(result).toEqual({
      items: [
        { id: '1', text: 'Inspect current code', status: 'completed' },
        { id: '2', text: 'Implement fix', status: 'in_progress' },
      ],
      rendered: '[x] #1: Inspect current code\n[>] #2: Implement fix\n\n(1/2 completed)',
      totalCount: 2,
      completedCount: 1,
      inProgressCount: 1,
      pendingCount: 0,
    });
  });

  it('publishes auto mode metadata for the planning tool', () => {
    const tool = new TodoTool().toAgentTool();
    expect(tool.autoAllowed).toBe(true);
    expect(tool.needsApproval).toBe(false);
  });
});
