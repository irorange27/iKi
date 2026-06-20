import { injectGetUserDataPath } from '@iki/backend/logger';
import { getUserDataPath } from './platform';

export function wireCoreContext(): void {
  injectGetUserDataPath(getUserDataPath);
}
