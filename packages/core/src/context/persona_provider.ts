let _getPersonaPrompt: (() => string) | null = null;

export function injectGetPersonaPrompt(fn: () => string) {
  _getPersonaPrompt = fn;
}

export function getPersonaPrompt(): string {
  if (!_getPersonaPrompt) throw new Error('getPersonaPrompt not injected');
  return _getPersonaPrompt();
}
