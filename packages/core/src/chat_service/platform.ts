import type { ChatServicePlatformDeps, ChatCompanionBridge, ContinuityRetrievalPayload } from '@iki/core/chat_platform';
import { noopCompanionBridge } from '@iki/core/chat_platform';

let _platform: ChatServicePlatformDeps = { companion: noopCompanionBridge };
let _platformSet = false;

export const setChatServicePlatformDeps = (deps: ChatServicePlatformDeps): void => {
  if (_platformSet) return;
  _platform = deps;
  _platformSet = true;
};

export const getChatServicePlatformDeps = (): ChatServicePlatformDeps => _platform;

export const getCompanion = (): ChatCompanionBridge => _platform.companion ?? noopCompanionBridge;

export const getExportTrace = (): ChatServicePlatformDeps['exportTrace'] => _platform.exportTrace;

export const getClipboardContextMessage = (maxEntries: number): string | undefined =>
  _platform.getClipboardContextMessage?.(maxEntries);

export const getAssistantProfileContextMessage = (): string =>
  _platform.getAssistantProfileContextMessage?.() ?? '';

export const retrieveRelevantContinuity = (query: string): ContinuityRetrievalPayload | null =>
  _platform.retrieveRelevantContinuity?.(query) ?? null;

export const onMessagePersisted = async (params: { threadId: string; messageId: string; messageJson: string }): Promise<void> => {
  await _platform.onMessagePersisted?.(params);
};

export const getAutoPinnedSkillIds = (threadId: string): string[] =>
  _platform.getAutoPinnedSkillIds?.(threadId) ?? [];

export const recordAutoSkillSelection = (params: { threadId: string; availableSkillIds: string[]; selectedSkillIds: string[]; timestamp?: string }): void => {
  _platform.recordAutoSkillSelection?.(params);
};
