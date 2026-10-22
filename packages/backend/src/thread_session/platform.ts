import type { ChatServicePlatformDeps, ChatCompanionBridge } from '@iki/backend/chat_platform';
import { noopCompanionBridge } from '@iki/backend/chat_platform';

let _platform: ChatServicePlatformDeps = { companion: noopCompanionBridge };
let _platformSet = false;

export const setChatServicePlatformDeps = (deps: ChatServicePlatformDeps): void => {
  if (_platformSet) return;
  _platform = deps;
  _platformSet = true;
};

export const getChatServicePlatformDeps = (): ChatServicePlatformDeps => _platform;

export const getCompanion = (): ChatCompanionBridge => _platform.companion ?? noopCompanionBridge;
