import * as agentRunDb from '@iki/backend/db/agent_runs';
import * as awaitersDb from '@iki/backend/db/awaiters';
import * as chatThreadDb from '@iki/backend/db/chat_thread';
import { createLogger } from '@iki/backend/logger';
import { parseAwaiterTriggerSpec, type Awaiter } from '@iki/backend/types/awaiters';
import { createPrefixedId } from '@iki/backend/utils/id';
import { toIsoNow } from '@iki/backend/utils/text';
import { rebuildResumeHistoryFromEvents } from '@iki/backend/thread_session/run_rehydrator';
import type { ChatTurnOptions } from '../turn_prep/turn_preparer';
import { getErrorMessage } from '@iki/backend/utils/errors';

const awaiterLogger = createLogger({ module: 'awaiters' });

const WAKE_STALE_AFTER_MS = 10 * 60 * 1000;

const AWAITER_WAKE_SYSTEM_PROMPT = [
  'You are executing a deferred continue-later wake for the user.',
  'Resume the work concisely and helpfully without pretending this is uninterrupted consciousness.',
  'State why the thread woke up now in practical terms when helpful.',
  'Focus on re-entry clarity, next steps, and important deltas rather than replaying old context.',
  'Do not ask unnecessary follow-up questions if the deferred continuation can be completed directly.',
].join('\n');

const formatAwaiterTrigger = (awaiter: Pick<Awaiter, 'trigger_kind' | 'trigger_spec_json'>): string => {
  const trigger = parseAwaiterTriggerSpec(awaiter.trigger_spec_json, awaiter.trigger_kind);
  if (!trigger) return 'Unknown trigger';
  if (trigger.kind === 'time_at') return `time_at (${trigger.at})`;
  return `time_after (${trigger.delay_minutes} minute(s))`;
};

const buildAwaiterWakePrompt = (
  awaiter: Awaiter,
  params: { startedAt: string }
): string => {
  const sections = [
    `Awaiter title: ${awaiter.title}`,
    `Current wake time (ISO): ${params.startedAt}`,
    `Original trigger: ${formatAwaiterTrigger(awaiter)}`,
    awaiter.origin_run_id ? `Origin run id: ${awaiter.origin_run_id}` : '',
    awaiter.last_wake_at ? `Previous wake time (ISO): ${awaiter.last_wake_at}` : '',
    awaiter.last_error ? `Previous wake error:\n${awaiter.last_error}` : '',
    `Continuation objective:\n${awaiter.instruction}`,
    [
      'Execution instructions:',
      '- Continue the deferred work now.',
      '- Be explicit that this is a scheduled continuation when that improves clarity.',
      '- Prioritize next-step usefulness over long recap.',
      '- Keep the response concise and thread-local.',
    ].join('\n'),
  ];

  return sections.filter(Boolean).join('\n\n');
};

export type AwaiterRunnerHostPort = {
  notify?: (params: { title: string; body: string }) => void;
  pushAwaiterEvent?: (payload: unknown) => void;
};

export type AwaiterRunnerChatPort = {
  getThread: (threadId: string) => { id: string } | null;
  createMessage: (input: unknown) => unknown;
  stream: (options: ChatTurnOptions) => Promise<{
    success: boolean;
    error?: string;
    text?: string;
    runId?: string;
  }>;
};

export type AwaiterRunnerDeps = {
  chat: AwaiterRunnerChatPort;
  host: AwaiterRunnerHostPort;
};

export const createAwaiterRunner = (deps: AwaiterRunnerDeps) => {
  const { chat, host } = deps;
  const awaiterInFlight = new Set<string>();

  const sendPushEventToRenderers = (payload: unknown) => host.pushAwaiterEvent?.(payload);

  const showDesktopNotification = (params: { title: string; body: string }) =>
    host.notify?.(params);

  const createThreadMessage = (params: {
  awaiter: Awaiter;
  threadId: string;
  kind: 'success' | 'error';
  startedAt: string;
  text: string;
  stage?: string;
  runId?: string | null;
}) => {
  const uiMessage = {
    id: createPrefixedId('msg'),
    role: 'assistant',
    parts: [{ type: 'text', text: params.text }],
  };

  chat.createMessage({
    id: uiMessage.id,
    thread_id: params.threadId,
    parent_id: null,
    depth: 0,
    message: JSON.stringify(uiMessage),
    timestamp: params.startedAt,
    metadata: JSON.stringify({
      format: 'ai-ui-message-v1',
      source: 'awaiter',
      awaiterId: params.awaiter.id,
      kind: params.kind,
      ...(params.stage ? { stage: params.stage } : {}),
      ...(params.runId ? { runId: params.runId } : {}),
    }),
  });

  chatThreadDb.touchChatThread(params.threadId);
  return uiMessage;
};

const isAwaiterRunnable = (awaiter: Awaiter): boolean =>
  awaiter.status === 'armed' || awaiter.status === 'waking';

type AwaiterPostWakeDisposition = 'suppress' | 'preserve' | 'settle';

const getAwaiterPostWakeDisposition = (awaiterId: string): AwaiterPostWakeDisposition => {
  const current = awaitersDb.getAwaiter(awaiterId);
  if (!current || current.status === 'cancelled') {
    return 'suppress';
  }
  return current.status === 'waking' ? 'settle' : 'preserve';
};

const transitionAwaiterIfStillWaking = (
  awaiterId: string,
  updates: Partial<Awaiter>
): AwaiterPostWakeDisposition => {
  const updateResult = awaitersDb.updateAwaiterIfStatus(awaiterId, 'waking', updates);
  if ((updateResult?.changes ?? 0) > 0) {
    return 'settle';
  }
  return getAwaiterPostWakeDisposition(awaiterId);
};

const buildSuppressedAwaiterResult = (runId?: string | null) => ({
  success: false as const,
  error: 'Awaiter no longer exists',
  ...(runId ? { runId } : {}),
});

  const runAwaiterWake = async (awaiterId: string) => {
  const awaiter = awaitersDb.getAwaiter(awaiterId);
  if (!awaiter) return { success: false, error: 'Awaiter not found' };
  const startedAt = toIsoNow();

  if (!isAwaiterRunnable(awaiter)) {
    return { success: false, error: `Awaiter is not armed (${awaiter.status})` };
  }
  if (awaiterInFlight.has(awaiterId)) {
    return { success: false, error: 'Awaiter already waking' };
  }
  if (!chat.getThread(awaiter.thread_id)) {
    awaitersDb.updateAwaiter(awaiterId, {
      status: 'failed',
      last_error: 'Target thread is unavailable',
      last_wake_at: startedAt,
      next_wake_at: null,
    });
    return { success: false, error: 'Target thread is unavailable' };
  }

  awaiterInFlight.add(awaiterId);

  const claim = awaitersDb.updateAwaiterIfStatus(awaiterId, 'armed', {
    status: 'waking',
    last_error: null,
    next_wake_at: null,
  });
  if ((claim?.changes ?? 0) === 0) {
    awaiterInFlight.delete(awaiterId);
    return { success: false, error: 'Awaiter wake already claimed' };
  }

  try {
    const messages: import('../message/model_history').ModelMessage[] = [
      { role: 'system', content: AWAITER_WAKE_SYSTEM_PROMPT },
    ];

    if (awaiter.origin_run_id) {

      const originRun = agentRunDb.getAgentRun(awaiter.origin_run_id);
      const originThreadId = originRun?.threadId;
      const resumedMessages = originThreadId
        ? ((await rebuildResumeHistoryFromEvents(originThreadId))?.history ?? [])
        : [];
      if (resumedMessages.length > 0) {
        messages.push({
          role: 'system',
          content: '[RESUMED CONTEXT] Continuing from a deferred continuation created during a previous agent run. The conversation history from that run is provided below.',
        });
        messages.push(...resumedMessages);
        messages.push({
          role: 'system',
          content: '[CONTINUATION] The following is the scheduled wake instruction:',
        });
      }
    }

    messages.push({
      role: 'user',
      content: buildAwaiterWakePrompt(awaiter, { startedAt }),
    });

    const result = await chat.stream({
      providerType: awaiter.provider_type,
      providerId: awaiter.provider_id ?? undefined,
      model: awaiter.model,
      messages,
      threadId: awaiter.thread_id,
      runConfig: {
        kind: 'awaiter-wake',
        parentRunId: awaiter.origin_run_id ?? undefined,
        rootRunId: awaiter.origin_run_id
          ? (agentRunDb.getAgentRun(awaiter.origin_run_id)?.rootRunId ?? undefined)
          : undefined,
        metadata: {
          source: 'awaiter',
          awaiterId: awaiter.id,
          originRunId: awaiter.origin_run_id ?? null,
          triggerKind: awaiter.trigger_kind,
        },
      },
    });

    const runId = typeof result.runId === 'string' ? result.runId : null;

    if (result.success === false) {
      const errorText = result.error || 'Unknown error';
      const failureDisposition = transitionAwaiterIfStillWaking(awaiterId, {
        status: 'failed',
        last_wake_at: startedAt,
        last_error: errorText,
        next_wake_at: null,
      });
      if (failureDisposition === 'suppress') {
        return buildSuppressedAwaiterResult(runId);
      }

      const uiMessage = createThreadMessage({
        awaiter,
        threadId: awaiter.thread_id,
        kind: 'error',
        startedAt,
        runId,
        text: [
          `### Later Continuation Failed: ${awaiter.title}`,
          `Wake: ${new Date(startedAt).toLocaleString()}`,
          '',
          '```',
          errorText,
          '```',
        ].join('\n'),
      });

      if (awaiter.notify) {
        showDesktopNotification({
          title: `Continuation failed: ${awaiter.title}`,
          body: errorText.slice(0, 180),
        });
      }

      sendPushEventToRenderers({
        type: 'awaiter-result',
        awaiterId: awaiter.id,
        threadId: awaiter.thread_id,
        status: 'failed',
        runAt: startedAt,
        message: uiMessage,
      });
      return { success: false, error: errorText, runId };
    }

    const outputText = typeof result.text === 'string' ? result.text : '';
    const messageText = [
      `### Later Continuation: ${awaiter.title}`,
      `Wake: ${new Date(startedAt).toLocaleString()}`,
      `Trigger: ${formatAwaiterTrigger(awaiter)}`,
      '',
      outputText.trim() ? outputText : '_No output._',
    ].join('\n');

    if (getAwaiterPostWakeDisposition(awaiterId) === 'suppress') {
      return buildSuppressedAwaiterResult(runId);
    }

    const completionDisposition = transitionAwaiterIfStillWaking(awaiterId, {
      status: 'completed',
      last_wake_at: startedAt,
      last_error: null,
      next_wake_at: null,
    });
    if (completionDisposition === 'suppress') {
      return buildSuppressedAwaiterResult(runId);
    }

    const uiMessage = createThreadMessage({
      awaiter,
      threadId: awaiter.thread_id,
      kind: 'success',
      startedAt,
      runId,
      text: messageText,
    });

    if (awaiter.notify) {
      showDesktopNotification({
        title: `Later continuation: ${awaiter.title}`,
        body: outputText.trim().slice(0, 180) || 'Completed',
      });
    }

    sendPushEventToRenderers({
      type: 'awaiter-result',
      awaiterId: awaiter.id,
      threadId: awaiter.thread_id,
      status: 'completed',
      runAt: startedAt,
      message: uiMessage,
    });

    return { success: true, runId };
  } catch (error) {
    const errorText = getErrorMessage(error);
    const catchDisposition = transitionAwaiterIfStillWaking(awaiterId, {
      status: 'failed',
      last_wake_at: startedAt,
      last_error: errorText,
      next_wake_at: null,
    });
    if (catchDisposition === 'suppress') {
      return buildSuppressedAwaiterResult();
    }
    return { success: false, error: errorText };
  } finally {
    awaiterInFlight.delete(awaiterId);
  }
};

  let tickInFlight = false;

  const tick = async (): Promise<void> => {
    if (tickInFlight) return;
    tickInFlight = true;

    try {

      const reclaimed = awaitersDb.reclaimStaleWakingAwaiters(
        new Date(Date.now() - WAKE_STALE_AFTER_MS).toISOString()
      );
      if (reclaimed > 0) {
        awaiterLogger.event({
          level: 'warn',
          event: 'awaiter.scheduler.reclaim',
          outcome: 'degraded',
          message: `Reclaimed ${reclaimed} awaiter(s) stuck in waking.`,
          data: { reclaimed },
        });
      }

      const dueAwaiters = awaitersDb.listDueAwaiters(toIsoNow());
      for (const awaiter of dueAwaiters) {
        if (awaiterInFlight.has(awaiter.id)) continue;
        await runAwaiterWake(awaiter.id);
      }
    } catch (error) {
      awaiterLogger.event({
        level: 'warn',
        event: 'awaiter.scheduler.tick',
        outcome: 'failed',
        error,
      });
    } finally {
      tickInFlight = false;
    }
  };

  return { runAwaiterWake, tick };
};

export type AwaiterRunner = ReturnType<typeof createAwaiterRunner>;
