import { injectGetUserDataPath } from '@iki/core/logger';
import { getUserDataPath } from './platform';

export function wireCoreContext(): void {
  injectGetUserDataPath(getUserDataPath);
}
