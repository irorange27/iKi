import { injectGetUserDataPath } from '@iki/backend/logger';
import { getUserDataPath } from './platform';

export function wirePlatformContext(): void {
  injectGetUserDataPath(getUserDataPath);
}
