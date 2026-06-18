let _getUserDataPath: (() => string) | null = null;

export function injectGetUserDataPath(fn: () => string) {
  _getUserDataPath = fn;
}

export function getUserDataPath(): string {
  if (!_getUserDataPath) throw new Error('getUserDataPath not injected');
  return _getUserDataPath();
}
