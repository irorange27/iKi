type ThreadWorkspaceSelection = {
  threadId: string;
  workspaceId: string | null;
  workspace: { path: string } | null;
};

let _ensureThreadWorkspaceSelection: ((threadId?: string | null) => ThreadWorkspaceSelection | null) | null = null;

export function injectEnsureThreadWorkspaceSelection(fn: NonNullable<typeof _ensureThreadWorkspaceSelection>) {
  _ensureThreadWorkspaceSelection = fn;
}

export function ensureThreadWorkspaceSelection(threadId?: string | null): ThreadWorkspaceSelection | null {
  if (!_ensureThreadWorkspaceSelection) throw new Error('ensureThreadWorkspaceSelection not injected');
  return _ensureThreadWorkspaceSelection(threadId);
}
