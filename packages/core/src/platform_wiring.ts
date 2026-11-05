import { injectGetUserDataPath } from '@iki/core/logger';
import { getUserDataPath } from './platform';

export function wirePlatformContext(): void {
  injectGetUserDataPath(getUserDataPath);
}
