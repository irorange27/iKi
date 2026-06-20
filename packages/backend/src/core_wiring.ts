import { injectGetUserDataPath } from '@iki/core/context/platform_provider';
import { getUserDataPath } from './platform';

export function wireCoreContext(): void {
  injectGetUserDataPath(getUserDataPath);
}
