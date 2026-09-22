import { ref, watch, type Ref } from 'vue';
import type { FileUIPart } from 'ai';

import type { ChatUiMessage, ComposerInvocationPartData } from '@iki/backend/message/message_parts';
import type { AudioEmotionResult } from '@iki/backend/types/speech';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import type { ModelCapabilitySnapshot, Provider } from '@iki/backend/types/provider';
import { getErrorMessage } from '@iki/backend/utils/errors';
import { createLogger } from '../logger';
import { createChatComposerStreamPayload } from '../modules/chat/message_send_transport';
import type {
  PreparedMessageSend,
  PrepareMessageSendPayload,
} from '../modules/chat/chat_prepare_send';

const chatComposerSendLogger = createLogger({ module: 'chat_composer_send' });

export type ComposerProviderReadyResult =
  | {
      ok: true;
      provider: Provider;
      model: string;
      modelCapability?: ModelCapabilitySnapshot | null;
    }
  | {
      ok: false;
      message: string;
    };

export type ResolvedComposerSendRequest =
  | {
      kind: 'message';
      content: string;
      promptAppId?: string;
      skillMode?: 'manual' | 'auto';
      skillIds?: string[];
      composerInvocations?: ComposerInvocationPartData;
      onCommitted?: () => void;
    }
  | {
      kind: 'skip';
      feedback?: string;
    };

export type SubmitTurnParams = {
  preparedMessageSend: PreparedMessageSend;
  body: NonNullable<ReturnType<typeof createChatComposerStreamPayload>>;
};

export type SubmitTurnResult = { ok: boolean; error?: string };

export const useChatComposerSend = (deps: {
  electronAPI: Pick<ElectronApi, 'chat'>;
  message: Ref<string>;
  isRecording: Ref<boolean>;
  isTranscribing: Ref<boolean>;
  selectedSkillIds: Ref<string[]>;
  isAutoSkillMode: Ref<boolean>;
  isAutonomousMode: Ref<boolean>;
  autonomousMaxIterations: Ref<number>;
  reasoningEffort: Ref<string>;
  personality: Ref<string>;
  approvalPolicy: Ref<string>;
  prepareFailedMessage: string;
  stopFailedMessage: string;
  prepareMessageSend?: (payload: PrepareMessageSendPayload) => Promise<PreparedMessageSend | null>;
  submitTurn: (params: SubmitTurnParams) => Promise<SubmitTurnResult>;
  resolveSendRequest?: (draft: string) => Promise<ResolvedComposerSendRequest>;
  canResolveEmptyDraft?: () => boolean;
  ensureProviderReady: () => Promise<ComposerProviderReadyResult>;
  /** Work threads: return a feedback message when the project workspace is missing; null = ok. */
  ensureWorkspaceForWork?: () => string | null;
  stopVoiceInput: () => void;
  attachedImages?: Ref<FileUIPart[]>;
  audioEmotion?: Ref<AudioEmotionResult | null>;
}) => {
  const composerFeedback = ref('');
  const isPreparingSend = ref(false);
  const isLoading = ref(false);
  const isStopping = ref(false);

  const dismissComposerFeedback = () => {
    composerFeedback.value = '';
  };

  const setComposerFeedback = (message: string) => {
    composerFeedback.value = message.trim();
  };

  watch(
    () => deps.message.value,
    (nextValue, previousValue) => {
      if (nextValue !== previousValue && composerFeedback.value) {
        dismissComposerFeedback();
      }
    }
  );

  const stopStreaming = async () => {
    if (!isLoading.value || isStopping.value) return;

    dismissComposerFeedback();
    isStopping.value = true;

    try {
      const result = await deps.electronAPI.chat.stopStream();
      if (!result?.success) {
        chatComposerSendLogger.event({
          level: 'warn',
          event: 'chat.stream.stop',
          outcome: 'failed',
          message: typeof result?.error === 'string' ? result.error : 'Unknown error',
        });
        setComposerFeedback(
          typeof result?.error === 'string' && result.error.trim().length > 0
            ? result.error
            : deps.stopFailedMessage
        );
        isLoading.value = false;
        isStopping.value = false;
      } else {
        // Allow user to send a new/steering message immediately after stop.
        // The old stream will unwind in the background; any late UI chunks
        // from it are superseded by the new stream when the user sends.
        isLoading.value = false;
        isStopping.value = false;
      }
    } catch (error) {
      chatComposerSendLogger.event({
        level: 'error',
        event: 'chat.stream.stop',
        outcome: 'failed',
        error,
      });
      setComposerFeedback(deps.stopFailedMessage);
      isLoading.value = false;
      isStopping.value = false;
    }
  };

  const sendMessage = async () => {
    if (deps.isRecording.value || deps.isTranscribing.value) {
      deps.stopVoiceInput();
      return;
    }

    const draftMessage = deps.message.value;
    const hasDraftContent = draftMessage.trim().length > 0;
    const canResolveEmptyDraft = deps.canResolveEmptyDraft?.() ?? false;
    if ((!hasDraftContent && !canResolveEmptyDraft) || isPreparingSend.value || isLoading.value) {
      return;
    }

    dismissComposerFeedback();

    const resolvedSendRequest = deps.resolveSendRequest
      ? await deps.resolveSendRequest(draftMessage)
      : {
          kind: 'message' as const,
          content: draftMessage,
        };

    if (resolvedSendRequest.kind === 'skip') {
      if (resolvedSendRequest.feedback) {
        setComposerFeedback(resolvedSendRequest.feedback);
      }
      return;
    }

    const userMessage = resolvedSendRequest.content.trim();
    if (!userMessage) {
      return;
    }

    const effectiveSkillMode =
      resolvedSendRequest.skillMode ?? (deps.isAutoSkillMode.value ? 'auto' : 'manual');
    const effectiveSelectedSkillIds =
      resolvedSendRequest.skillMode === 'manual' && Array.isArray(resolvedSendRequest.skillIds)
        ? resolvedSendRequest.skillIds
        : deps.selectedSkillIds.value;

    const providerReady = await deps.ensureProviderReady();
    if (providerReady.ok === false) {
      setComposerFeedback(providerReady.message);
      return;
    }
    const readyProvider = {
      provider: providerReady.provider,
      model: providerReady.model,
      modelCapability: providerReady.modelCapability ?? null,
    };
    const workspaceMissing = deps.ensureWorkspaceForWork?.();
    if (workspaceMissing) {
      setComposerFeedback(workspaceMissing);
      return;
    }

    isPreparingSend.value = true;

    let preparedMessageSend: PreparedMessageSend | null = null;
    try {
      if (!deps.prepareMessageSend) {
        chatComposerSendLogger.event({
          level: 'error',
          event: 'chat.send.prepare',
          outcome: 'failed',
          message: 'Missing prepareMessageSend handler.',
        });
      } else {
        preparedMessageSend = await deps.prepareMessageSend({
          content: userMessage,
          model: providerReady.model,
          providerId: providerReady.provider.id,
          promptAppId: resolvedSendRequest.promptAppId,
          composerInvocations: resolvedSendRequest.composerInvocations,
          files: deps.attachedImages?.value?.length
            ? [...deps.attachedImages.value]
            : undefined,
          audioEmotion: deps.audioEmotion?.value ?? undefined,
        });
      }
    } catch (error) {
      chatComposerSendLogger.event({
        level: 'error',
        event: 'chat.send.prepare',
        outcome: 'failed',
        error,
      });
    } finally {
      isPreparingSend.value = false;
    }

    if (!preparedMessageSend) {
      setComposerFeedback(deps.prepareFailedMessage);
      return;
    }

    const previousMessage = deps.message.value;
    deps.message.value = '';
    deps.attachedImages?.value && (deps.attachedImages.value = []);
    deps.audioEmotion?.value && (deps.audioEmotion.value = null);
    resolvedSendRequest.onCommitted?.();
    isLoading.value = true;
    isStopping.value = false;

    try {
      const body = createChatComposerStreamPayload({
        providerReady: readyProvider,
        threadId: preparedMessageSend.threadId,
        isAutoSkillMode: effectiveSkillMode === 'auto',
        selectedSkillIds: effectiveSelectedSkillIds,
        reasoningEffort: deps.reasoningEffort.value,
        personality: deps.personality.value,
        approvalPolicy: deps.approvalPolicy.value,
        ...(deps.isAutonomousMode.value
          ? { autonomous: { maxIterations: deps.autonomousMaxIterations.value } }
          : {}),
      });

      if (!body) {
        chatComposerSendLogger.event({
          level: 'warn',
          event: 'chat.send',
          outcome: 'skipped',
          message: 'No valid thread to send to.',
        });
        deps.message.value = previousMessage;
        setComposerFeedback(deps.prepareFailedMessage);
        isLoading.value = false;
        return;
      }

      const submitResult = await deps.submitTurn({ preparedMessageSend, body });
      if (!submitResult.ok) {
        throw new Error(submitResult.error || 'Stream failed');
      }

      isLoading.value = false;
      isStopping.value = false;
    } catch (error: unknown) {
      chatComposerSendLogger.event({
        level: 'error',
        event: 'chat.send',
        outcome: 'failed',
        error,
      });
      deps.message.value = previousMessage;
      isLoading.value = false;
      isStopping.value = false;
      const message = getErrorMessage(error);
      chatComposerSendLogger.event({
        level: 'warn',
        event: 'chat.send',
        outcome: 'degraded',
        message,
      });
      setComposerFeedback(message);
    }
  };

  return {
    composerFeedback,
    isPreparingSend,
    isLoading,
    isStopping,
    dismissComposerFeedback,
    sendMessage,
    stopStreaming,
  };
};
