import { Notification, app } from 'electron';

import * as agentRunDb from '@iki/backend/db/agent_runs';
import * as awaitersDb from '@iki/backend/db/awaiters';
import * as chatThreadDb from '@iki/backend/db/chat_thread';
import { createLogger } from '@iki/backend/logger';
import { parseAwaiterTriggerSpec, type Awaiter } from '@iki/backend/types/awaiters';
import { createPrefixedId } from '@iki/backend/utils/id';
import { toIsoNow } from '@iki/backend/utils/text';
import { deliverBridgeThreadMessage } from '@iki/backend/bridge_dispatch';
import { getErrorMessage } from '../../utils/errors';
import { getAllBrowserWindows } from '../../utils/browser_windows';
import { chatService } from '../chat/service';

const SCHEDULER_TICK_MS = 30_000;
const awaiterLogger = createLogger({ module: 'awaiters' });

let schedulerTimer: NodeJS.Timeout | null = null;
let tickInFlight = false;
const awaiterInFlight = new Set<string>();

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

const sendPushEventToRenderers = (payload: unknown) => {
  for (const win of getAllBrowserWindows()) {
    try {
      win.webContents.send('awaiters:push', payload);
    } catch (error) {
      awaiterLogger.event({
        level: 'warn',
        event: 'awaiter.push',
        outcome: 'degraded',
        error,
      });
    }
  }
};

const showDesktopNotification = (params: { title: string; body: string }) => {
  try {
    if (!app.isReady()) return;
    if (!Notification.isSupported()) return;
    new Notification({
      title: params.title,
      body: params.body,
    }).show();
  } catch (error) {
    awaiterLogger.event({
      level: 'warn',
      event: 'awaiter.notification',
      outcome: 'degraded',
      error,
    });
  }
};

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

  chatService.createMessage({
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

const persistWakeEvent = (params: {
  awaiter: Awaiter;
  triggerFiredAt: string;
  outcome: 'success' | 'error';
  error?: string | null;
  runId?: string | null;
}) => {
  try {
    awaitersDb.addAwaiterWakeEvent({
      id: createPrefixedId('awaiter_wake'),
      awaiter_id: params.awaiter.id,
      run_id: params.runId ?? null,
      trigger_fired_at: params.triggerFiredAt,
      trigger_snapshot_json: JSON.stringify({
        triggerKind: params.awaiter.trigger_kind,
        triggerSpec: parseAwaiterTriggerSpec(
          params.awaiter.trigger_spec_json,
          params.awaiter.trigger_kind
        ),
        scheduledFor: params.awaiter.next_wake_at ?? null,
      }),
      outcome: params.outcome,
      error: params.error ?? null,
    });
    return true;
  } catch (error) {
    const errorText = getErrorMessage(error);
    if (errorText.includes('FOREIGN KEY constraint failed')) {
      awaiterLogger.event({
        level: 'warn',
        event: 'awaiter.wake_event',
        outcome: 'skipped',
        message: 'Skipped wake audit row because the awaiter was removed before persistence.',
        error,
        entity: {
          awaiter_id: params.awaiter.id,
          run_id: params.runId ?? null,
        },
      });
      return false;
    }
    throw error;
  }
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

export const runAwaiterWake = async (awaiterId: string) => {
  const awaiter = awaitersDb.getAwaiter(awaiterId);
  if (!awaiter) return { success: false, error: 'Awaiter not found' };
  const startedAt = toIsoNow();

  if (!isAwaiterRunnable(awaiter)) {
    return { success: false, error: `Awaiter is not armed (${awaiter.status})` };
  }
  if (awaiterInFlight.has(awaiterId)) {
    return { success: false, error: 'Awaiter already waking' };
  }
  if (!chatService.getThread(awaiter.thread_id)) {
    awaitersDb.updateAwaiter(awaiterId, {
      status: 'failed',
      last_error: 'Target thread is unavailable',
      last_wake_at: startedAt,
      next_wake_at: null,
    });
    persistWakeEvent({
      awaiter,
      triggerFiredAt: startedAt,
      outcome: 'error',
      error: 'Target thread is unavailable',
    });
    return { success: false, error: 'Target thread is unavailable' };
  }

  awaiterInFlight.add(awaiterId);
  awaitersDb.updateAwaiter(awaiterId, {
    status: 'waking',
    last_error: null,
  });

  try {
    const messages: import('ai').ModelMessage[] = [
      { role: 'system', content: AWAITER_WAKE_SYSTEM_PROMPT },
    ];

    if (awaiter.origin_run_id) {
      const checkpoint = agentRunDb.getLatestAgentRunCheckpoint(awaiter.origin_run_id);
      if (
        checkpoint?.snapshot?.working?.modelMessages &&
        Array.isArray(checkpoint.snapshot.working.modelMessages) &&
        checkpoint.snapshot.working.modelMessages.length > 0
      ) {
        const checkpointMessages = checkpoint.snapshot.working.modelMessages as import('ai').ModelMessage[];
        messages.push({
          role: 'system',
          content: '[RESUMED CONTEXT] Continuing from a deferred continuation created during a previous agent run. The conversation history from that run is provided below.',
        });
        messages.push(...checkpointMessages);
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

    const result = await chatService.send({
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
      if (
        !persistWakeEvent({
          awaiter,
          triggerFiredAt: startedAt,
          outcome: 'error',
          error: errorText,
          runId,
        })
      ) {
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

    const bridgeDelivery = await deliverBridgeThreadMessage({
      threadId: awaiter.thread_id,
      text: messageText,
    });

    if (bridgeDelivery.handled && !bridgeDelivery.delivered) {
      const deliveryError = `Failed to deliver ${bridgeDelivery.source || 'bridge'} message: ${
        bridgeDelivery.error || 'Unknown error'
      }`;

      const deliveryFailureDisposition = transitionAwaiterIfStillWaking(awaiterId, {
        status: 'failed',
        last_wake_at: startedAt,
        last_error: deliveryError,
        next_wake_at: null,
      });
      if (deliveryFailureDisposition === 'suppress') {
        return buildSuppressedAwaiterResult(runId);
      }
      if (
        !persistWakeEvent({
          awaiter,
          triggerFiredAt: startedAt,
          outcome: 'error',
          error: deliveryError,
          runId,
        })
      ) {
        return buildSuppressedAwaiterResult(runId);
      }

      const failedDeliveryMessage = createThreadMessage({
        awaiter,
        threadId: awaiter.thread_id,
        kind: 'error',
        stage: 'bridge-delivery',
        startedAt,
        runId,
        text: [
          `### Later Continuation Delivery Failed: ${awaiter.title}`,
          `Wake: ${new Date(startedAt).toLocaleString()}`,
          '',
          'Generated output:',
          outputText.trim() ? outputText : '_No output._',
          '',
          'Error:',
          '```',
          deliveryError,
          '```',
        ].join('\n'),
      });

      if (awaiter.notify) {
        showDesktopNotification({
          title: `Continuation failed: ${awaiter.title}`,
          body: deliveryError.slice(0, 180),
        });
      }

      sendPushEventToRenderers({
        type: 'awaiter-result',
        awaiterId: awaiter.id,
        threadId: awaiter.thread_id,
        status: 'failed',
        runAt: startedAt,
        message: failedDeliveryMessage,
      });
      return { success: false, error: deliveryError, runId };
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
    if (
      !persistWakeEvent({
        awaiter,
        triggerFiredAt: startedAt,
        outcome: 'success',
        runId,
      })
    ) {
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
    if (
      !persistWakeEvent({
        awaiter,
        triggerFiredAt: startedAt,
        outcome: 'error',
        error: errorText,
      })
    ) {
      return buildSuppressedAwaiterResult();
    }
    return { success: false, error: errorText };
  } finally {
    awaiterInFlight.delete(awaiterId);
  }
};

const tick = async () => {
  if (tickInFlight) return;
  tickInFlight = true;

  try {
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

export const startAwaiterScheduler = () => {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    void tick();
  }, SCHEDULER_TICK_MS);
  void tick();
};

export const stopAwaiterScheduler = () => {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
};
