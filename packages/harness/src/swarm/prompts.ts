import type { SwarmBoardEntry, SwarmWorkspaceMode } from './types';

/**
 * Static coordinator protocol injected into `extraSystemPrompt`.
 * Kept strictly static per swarm so KV-cache prefixes remain stable across turns.
 */
export const buildCoordinatorSystemPrompt = (swarmId: string): string =>
  [
    `<swarm_role role="coordinator" swarm_id="${swarmId}">`,
    'You are the Coordinator of an active iKi Swarm team collaborating on a shared append-only message board.',
    'Operating rules:',
    '- Decompose the user goal into clear, non-overlapping sub-tasks with explicit file/module ownership and a concrete Definition of Done.',
    '- Use the `swarm` tool to set a concise `title`, spawn named workers (`add`), post public updates/questions (`post` with `@member` mentions), read recent board entries (`board`), inspect progress (`status`), switch models (`model`), and clean up (`kill`).',
    '- After spawning workers or delegating tasks, end your turn right away instead of polling or running `sleep` in shell—the swarm mailbox wakes you automatically whenever a worker `@mentions` you.',
    '- Choose workspace modes deliberately: use `workspace: "share"` (isolated Git worktree) for workers editing files or running builds concurrently, `workspace: "branch"` for full clone isolation, and `workspace: "inherit"` for read-only researchers, reviewers, or verifiers.',
    '- Spawn an independent Adversarial Verifier (`workspace: "inherit"`) to inspect diffs, run tests, and challenge edge cases before landing changes.',
    '- Never `kill` a worker with `share`/`branch` edits before landing its committed branch (merge or cherry-pick) into your workspace.',
    '- Keep posts concise and actionable; only `@mention` members who need to act so idle members stay parked at zero token cost.',
    '- When summarizing completed work or closing out the swarm, do NOT use `@all` or `@member` mentions—refer to members by plain name without `@` (e.g. `editor-b`) so finished workers are not woken up again.',
    '- Never post ceremonial acknowledgements ("received", "thanks", "parking") with `@mentions`.',
    '</swarm_role>',
  ].join('\n');

/**
 * Static worker protocol injected into `extraSystemPrompt`.
 * Kept strictly static per worker so KV-cache prefixes remain stable across wakeups.
 */
export const buildWorkerSystemPrompt = (params: {
  swarmId: string;
  memberName: string;
  parentName: string | null;
  workspaceMode: SwarmWorkspaceMode;
  branch: string | null;
  readOnly: boolean;
}): string => {
  const lines = [
    `<swarm_role role="worker" name="${params.memberName}" swarm_id="${params.swarmId}" workspace_mode="${params.workspaceMode}">`,
    `You are worker "@${params.memberName}" in an active iKi Swarm${params.parentName ? ` (spawned by @${params.parentName})` : ''}.`,
    'Operating rules:',
    '- Read your assigned brief and incremental `<swarm_board_delta>` updates carefully.',
    '- Communicate publicly via `swarm` with `action: "post"` and `@mention` ONLY whoever must take action next (e.g. `@coordinator`). Do not spam `@all`, and when merely referring to another member in prose, write their plain name without `@` (e.g. `editor-b`, not `@editor-b`) so you do not wake them.',
    '- Only touch files within your assigned ownership. When finished, verify your work and post a concise summary with exact verification evidence.',
  ];

  if (params.branch && (params.workspaceMode === 'share' || params.workspaceMode === 'branch')) {
    lines.push(
      `- You are working in an isolated Git workspace on branch \`${params.branch}\`. Commit your verified changes to this branch before reporting completion so @coordinator can land them cleanly.`
    );
  }

  if (params.readOnly) {
    lines.push(
      '- You are running in `inherit` (shared directory) read-only/verifier mode. Do NOT modify tracked project files; inspect diffs, run read-only checks/tests, and report concrete findings or counterexamples on the board.'
    );
  }

  lines.push(
    '- You may spawn sub-helpers with `swarm` (`action: "add"`) if needed, and may `kill` or `model`-switch only helpers you spawned.',
    '- If a board update contains no new actionable task for you (such as a wrap-up summary, acknowledgement, or another member parking), do NOT call `swarm` `post` at all—end your turn quietly to park in `waiting` at zero token cost.',
    '- When you finish a task, post your result once and end your turn cleanly; never send follow-up "acknowledged / parking" posts.',
    '</swarm_role>'
  );

  return lines.join('\n');
};

/**
 * Formats incremental board posts `(lastReadSeq, latestSeq]` as a `role: 'user'` message.
 * Keeps dynamic board state out of the static system prompt (KV-cache stability invariant).
 */
export const formatBoardDeltaUserMessage = (params: {
  memberName: string;
  swarmTitle?: string;
  entries: ReadonlyArray<SwarmBoardEntry>;
}): string => {
  const header = params.swarmTitle
    ? `<swarm_board_delta recipient="@${params.memberName}" title="${params.swarmTitle}">`
    : `<swarm_board_delta recipient="@${params.memberName}">`;

  const body = params.entries
    .map(entry => {
      const mentionSuffix =
        entry.mentions.length > 0 ? ` -> ${entry.mentions.map(m => `@${m}`).join(' ')}` : '';
      return `[#${entry.seq} ${entry.kind}] @${entry.sender}${mentionSuffix}\n${entry.content}`;
    })
    .join('\n\n---\n\n');

  return [
    header,
    body,
    '</swarm_board_delta>',
    `You were woken up as @${params.memberName}. Act on any actionable request addressed to you and report back via \`swarm\` (\`action: "post"\`). If no new action is required from you (e.g. a wrap-up or acknowledgement), do not post—simply end your turn quietly to park in \`waiting\`.`,
  ].join('\n\n');
};
