import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { daemonLoggerEventMock } = vi.hoisted(() => ({
  daemonLoggerEventMock: vi.fn(),
}));

vi.mock('../../src/core/db/chat_thread', () => ({
  getChatThread: vi.fn(),
}));

vi.mock('../../src/core/daemon_logs', () => ({
  createDaemonLogger: vi.fn(() => ({
    event: daemonLoggerEventMock,
  })),
}));

import * as chatThreadDb from '../../src/core/db/chat_thread';
import type { ChatThread } from '../../src/shared/types/chat';
import {
  deliverBridgeThreadMessage,
  getBridgeThreadSource,
  registerBridgeThreadSender,
} from '../../src/daemon/bridge_dispatch';

const createThread = (
  overrides: Partial<ChatThread> & Pick<ChatThread, 'id'>
): ChatThread => ({
  id: overrides.id,
  title: overrides.title || 'Thread',
  is_generating: false,
  metadata: overrides.metadata || '{}',
  created_at: '2026-03-20T00:00:00.000Z',
  updated_at: '2026-03-20T00:00:00.000Z',
  client_id: overrides.client_id,
  prompt_app_id: overrides.prompt_app_id,
  model: overrides.model,
  tools: overrides.tools,
  is_favorited: overrides.is_favorited ?? 0,
  is_incognito: overrides.is_incognito ?? 0,
  workspace_id: overrides.workspace_id,
  enable_artifacts: overrides.enable_artifacts ?? 0,
  artifact_workspace_id: overrides.artifact_workspace_id,
  skill_ids: overrides.skill_ids,
});

describe('bridge thread dispatch', () => {
  const getChatThreadMock = vi.mocked(chatThreadDb.getChatThread);
  let disposeNapCatSender: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    disposeNapCatSender?.();
    disposeNapCatSender = null;
  });

  it('detects NapCat threads from metadata and fallback ids', () => {
    expect(
      getBridgeThreadSource(createThread({
        id: 'thread_1',
        client_id: 'client_napcat',
        metadata: '{}',
      }))
    ).toBe('napcat');

    expect(
      getBridgeThreadSource(createThread({
        id: 'thread_2',
        client_id: undefined,
        metadata: JSON.stringify({ source: 'napcat' }),
      }))
    ).toBe('napcat');

    expect(
      getBridgeThreadSource(createThread({
        id: 'thread_3',
        client_id: undefined,
        metadata: '{}',
      }))
    ).toBeNull();
  });

  it('logs malformed metadata and falls back to client heuristics', () => {
    expect(
      getBridgeThreadSource(createThread({
        id: 'napcat_10001_private_20002',
        client_id: 'client_napcat',
        metadata: '{broken',
      }))
    ).toBe('napcat');

    expect(daemonLoggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        event: 'bridge.dispatch.metadata',
        outcome: 'degraded',
        message: 'Failed to parse bridge thread metadata; falling back to thread heuristics.',
        data: {
          thread_id: 'napcat_10001_private_20002',
        },
      })
    );
  });

  it('returns a bridge-specific error when no sender is registered', async () => {
    getChatThreadMock.mockReturnValue(createThread({
      id: 'napcat_10001_private_20002',
      client_id: 'client_napcat',
      metadata: '{}',
    }));

    const result = await deliverBridgeThreadMessage({
      threadId: 'napcat_10001_private_20002',
      text: 'hello',
    });

    expect(result).toEqual({
      handled: true,
      delivered: false,
      source: 'napcat',
      error: 'napcat bridge is not connected',
    });
  });

  it('dispatches outgoing text through the registered bridge sender', async () => {
    getChatThreadMock.mockReturnValue(createThread({
      id: 'napcat_10001_private_20002',
      client_id: 'client_napcat',
      metadata: JSON.stringify({ source: 'napcat', message_type: 'private', user_id: '20002' }),
    }));

    const sender = vi.fn().mockResolvedValue(undefined);
    disposeNapCatSender = registerBridgeThreadSender('napcat', sender);

    const result = await deliverBridgeThreadMessage({
      threadId: 'napcat_10001_private_20002',
      text: 'hello',
    });

    expect(result).toEqual({
      handled: true,
      delivered: true,
      source: 'napcat',
    });
    expect(sender).toHaveBeenCalledWith({
      thread: expect.objectContaining({
        id: 'napcat_10001_private_20002',
      }),
      text: 'hello',
    });
  });
});
