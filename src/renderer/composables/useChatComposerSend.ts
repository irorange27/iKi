import { ref, watch, type Ref } from 'vue';

import type { ComposerInvocationPartData } from '../../shared/chat/message_parts';
import type { ElectronApi } from '../../shared/types/electron_api';
import type { ModelCapabilitySnapshot, Provider } from '../../shared/types/provider';
import { getErrorMessage } from '../../shared/utils/errors';
import { createLogger } from '../logger';
import { createChatComposerStreamPayload } from '../modules/chat/chat_send_transport';
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

export const useChatComposerSend = (deps: {
  electronAPI: Pick<ElectronApi, 'chat'>;
  message: Ref<string>;
  isRecording: Ref<boolean>;
  isTranscribing: Ref<boolean>;
  selectedTools: Ref<string[]>;
  selectedMcpServerIds: Ref<string[]>;
  selectedSkillIds: Ref<string[]>;
  isAutoToolMode: Ref<boolean>;
  isAutoSkillMode: Ref<boolean>;
  prepareFailedMessage: string;
  stopFailedMessage: string;
  prepareMessageSend?: (payload: PrepareMessageSendPayload) => Promise<PreparedMessageSend | null>;
  resolveSendRequest?: (draft: string) => Promise<ResolvedComposerSendRequest>;
  ensureProviderReady: () => Promise<ComposerProviderReadyResult>;
  resolveSelectedMcpServerIds: () => Promise<string[]>;
  stopVoiceInput: () => void;
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
    if (!draftMessage.trim() || isPreparingSend.value || isLoading.value) {
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
    const resolvedMcpServerIds = await deps.resolveSelectedMcpServerIds();
    deps.selectedMcpServerIds.value = resolvedMcpServerIds;
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
          tools: deps.selectedTools.value,
          mcpServerIds: resolvedMcpServerIds,
          promptAppId: resolvedSendRequest.promptAppId,
          composerInvocations: resolvedSendRequest.composerInvocations,
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

    deps.message.value = '';
    resolvedSendRequest.onCommitted?.();
    isLoading.value = true;
    isStopping.value = false;

    try {
      const streamPayload = createChatComposerStreamPayload({
        providerReady: readyProvider,
        preparedMessageSend,
        isAutoToolMode: deps.isAutoToolMode.value,
        selectedTools: deps.selectedTools.value,
        resolvedMcpServerIds,
        isAutoSkillMode: effectiveSkillMode === 'auto',
        selectedSkillIds: effectiveSelectedSkillIds,
      });

      if (!streamPayload) {
        chatComposerSendLogger.event({
          level: 'warn',
          event: 'chat.send',
          outcome: 'skipped',
          message: 'No valid messages to send.',
        });
        setComposerFeedback(deps.prepareFailedMessage);
        isLoading.value = false;
        return;
      }

      const streamResult = await deps.electronAPI.chat.stream(streamPayload);
      if (streamResult?.success === false) {
        throw new Error(streamResult.error || 'Stream failed');
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
