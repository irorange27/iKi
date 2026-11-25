import type { SwarmBoardEntry, SwarmManager } from '@iki/harness/swarm';
import { rebuildThreadViewFromEvents } from '@iki/harness/thread_session/session_log';
import type { InteractiveCliState, SlashCommandOutcome } from './commands';

const clipLine = (text: string, max = 110): string => {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max - 3)}...` : single;
};

const readUiPreview = (parts: unknown): string => {
  if (!Array.isArray(parts)) return '';
  const text = parts
    .filter(
      (part): part is { type: string; text: string } =>
        Boolean(part) &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
    )
    .map(part => part.text)
    .join('\n')
    .trim();
  if (!text) return `[${parts.length} non-text part(s)]`;
  return clipLine(text, 120);
};

const formatSwarmUsageLines = (): string[] => [
  'Usage:',
  '  /swarm <task>                  Start (or continue) a swarm on this thread as @coordinator',
  '  /swarm status                  Show active swarm roster, branches, and member states',
  '  /swarm board [n]               Show last n posts from the shared append-only board',
  '  /swarm inspect <member>        Inspect recent messages in a member thread',
  '  /swarm post <message>          Post to the board as user (use @member to wake)',
  '  /swarm steer <member> <msg>    Send steering guidance directly to a member',
  '  /swarm kill <member|all>       Terminate worker(s) and clean up worktrees',
];

export const formatSwarmBoardEntryLine = (entry: SwarmBoardEntry): string => {
  const targetStr =
    entry.mentions.length > 0 ? ` -> ${entry.mentions.map(m => `@${m}`).join(' ')}` : '';
  return `[swarm #${entry.seq} ${entry.kind}] @${entry.sender}${targetStr}: ${clipLine(entry.content, 100)}`;
};

export const formatSwarmBadge = (
  swarmManager: SwarmManager | undefined,
  threadId: string
): string => {
  if (!swarmManager) return '';
  const swarm = swarmManager.getSwarmForThread(threadId);
  if (!swarm) return '';
  const status = swarmManager.status({ callerThreadId: threadId });
  const workers = status.members.filter(m => m.role === 'worker');
  const working = workers.filter(m => m.status === 'working').length;
  const waiting = workers.filter(m => m.status === 'waiting').length;
  return `swarm(${working}w/${waiting}i)`;
};

const formatSwarmStatusLines = (
  swarmManager: SwarmManager,
  threadId: string
): string[] => {
  const swarm = swarmManager.getSwarmForThread(threadId);
  if (!swarm) {
    return ['No active swarm on this thread.', ...formatSwarmUsageLines()];
  }
  const view = swarmManager.status({ callerThreadId: threadId });
  const lines = [
    `Swarm ${view.swarmId} — ${view.title} (turns ${view.totalTurns}/${view.maxTotalTurns}, board #${view.latestSeq}):`,
  ];
  for (const m of view.members) {
    const modelStr = m.providerId ? `${m.providerId}/${m.model}` : m.model;
    const branchPart = m.branch ? ` branch=${m.branch}` : '';
    const unreadPart = m.unreadSeqCount > 0 ? ` unread=${m.unreadSeqCount}` : '';
    const pendingPart = m.pendingEvents > 0 ? ` queued=${m.pendingEvents}` : '';
    lines.push(
      `  @${m.name.padEnd(16)} [${m.status}]  ${m.workspaceMode}${branchPart}  model=${modelStr}  turns=${m.turnsUsed}${unreadPart}${pendingPart}`
    );
  }
  return lines;
};

const formatSwarmBoardLines = (
  swarmManager: SwarmManager,
  threadId: string,
  limit = 20
): string[] => {
  const swarm = swarmManager.getSwarmForThread(threadId);
  if (!swarm) return ['No active swarm on this thread.'];
  const entries = swarmManager.readBoard(swarm.id, { limit });
  if (entries.length === 0) return [`Swarm ${swarm.id} board is empty.`];
  const lines = [`Swarm ${swarm.id} board (${entries.length} shown):`];
  for (const entry of entries) {
    const mentions =
      entry.mentions.length > 0 ? ` -> ${entry.mentions.map(m => `@${m}`).join(' ')}` : '';
    lines.push(`  #${entry.seq} [${entry.kind}] @${entry.sender}${mentions}`);
    for (const contentLine of entry.content.split(/\r?\n/).slice(0, 6)) {
      lines.push(`    ${contentLine}`);
    }
  }
  return lines;
};

const formatSwarmInspectLines = (
  swarmManager: SwarmManager,
  threadId: string,
  memberArg: string
): string[] => {
  const swarm = swarmManager.getSwarmForThread(threadId);
  if (!swarm) return ['No active swarm on this thread.'];
  const name = memberArg.trim().replace(/^@/, '');
  const member = swarm.members[name];
  if (!member) {
    return [`Unknown swarm member "@${name}". Active members: ${Object.keys(swarm.members).join(', ')}`];
  }
  const view = rebuildThreadViewFromEvents(member.threadId);
  const tail = view.messages.slice(-8);
  const lines = [
    `Member @${member.name} (thread=${member.threadId}, status=${member.status}, mode=${member.workspaceMode}${member.branch ? `, branch=${member.branch}` : ''}):`,
  ];
  if (tail.length === 0) {
    lines.push('  (no messages recorded yet)');
    return lines;
  }
  for (const msg of tail) {
    const label = msg.role === 'user' ? 'in ' : msg.role === 'assistant' ? 'out' : msg.role;
    lines.push(`  ${label}: ${readUiPreview(msg.parts)}`);
  }
  return lines;
};

export const executeSwarmSlashCommand = async (
  arg: string,
  state: InteractiveCliState,
  createWorkspaceSelection: (threadId: string, workspacePath: string) => {
    threadId: string;
    workspaceId: string;
    workspace: {
      id: string;
      name: string;
      path: string;
      is_temporary: boolean;
      show_in_list: boolean;
      created_at: string;
      updated_at: string;
    };
  }
): Promise<SlashCommandOutcome> => {
  const swarmManager = state.swarmManager;
  if (!swarmManager) {
    return { kind: 'handled', lines: ['Swarm runtime is not initialized in this CLI session.'] };
  }

  const trimmed = arg.trim();
  if (!trimmed || trimmed === 'status') {
    return { kind: 'handled', lines: formatSwarmStatusLines(swarmManager, state.threadId) };
  }

  const spaceIdx = trimmed.indexOf(' ');
  const sub = (spaceIdx >= 0 ? trimmed.slice(0, spaceIdx) : trimmed).toLowerCase();
  const rest = spaceIdx >= 0 ? trimmed.slice(spaceIdx + 1).trim() : '';

  if (sub === 'help') {
    return { kind: 'handled', lines: formatSwarmUsageLines() };
  }

  if (sub === 'board') {
    const parsedLimit = rest ? Number.parseInt(rest, 10) : 20;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;
    return { kind: 'handled', lines: formatSwarmBoardLines(swarmManager, state.threadId, limit) };
  }

  if (sub === 'inspect') {
    if (!rest) return { kind: 'handled', lines: ['Usage: /swarm inspect <member>'] };
    return { kind: 'handled', lines: formatSwarmInspectLines(swarmManager, state.threadId, rest) };
  }

  if (sub === 'post') {
    const swarm = swarmManager.getSwarmForThread(state.threadId);
    if (!swarm) return { kind: 'handled', lines: ['No active swarm on this thread.'] };
    if (!rest) return { kind: 'handled', lines: ['Usage: /swarm post <message with @mentions>'] };
    const posted = swarmManager.postAsUser(swarm.id, rest);
    return {
      kind: 'handled',
      lines: [
        `Posted #${posted.seq} to swarm ${swarm.id}` +
          (posted.woken.length ? ` (woke ${posted.woken.map(m => `@${m}`).join(', ')})` : ''),
      ],
    };
  }

  if (sub === 'steer') {
    const swarm = swarmManager.getSwarmForThread(state.threadId);
    if (!swarm) return { kind: 'handled', lines: ['No active swarm on this thread.'] };
    const memberSplit = rest.indexOf(' ');
    if (memberSplit < 0) return { kind: 'handled', lines: ['Usage: /swarm steer <member> <message>'] };
    const member = rest.slice(0, memberSplit).trim();
    const message = rest.slice(memberSplit + 1).trim();
    if (!member || !message) {
      return { kind: 'handled', lines: ['Usage: /swarm steer <member> <message>'] };
    }
    try {
      const outcome = swarmManager.steerMember(swarm.id, member, message);
      return {
        kind: 'handled',
        lines: [`Sent steer to @${member.replace(/^@/, '')} (${outcome.delivered}).`],
      };
    } catch (error) {
      return { kind: 'handled', lines: [error instanceof Error ? error.message : String(error)] };
    }
  }

  if (sub === 'kill') {
    const swarm = swarmManager.getSwarmForThread(state.threadId);
    if (!swarm) return { kind: 'handled', lines: ['No active swarm on this thread.'] };
    if (!rest) return { kind: 'handled', lines: ['Usage: /swarm kill <member|all>'] };
    try {
      if (rest === 'all') {
        const killed = await swarmManager.killAllWorkers(swarm.id);
        return {
          kind: 'handled',
          lines: [
            killed.length
              ? `Killed ${killed.length} worker(s): ${killed.map(m => `@${m}`).join(', ')}`
              : 'No active workers to kill.',
          ],
        };
      }
      await swarmManager.kill({ callerThreadId: state.threadId, name: rest });
      return { kind: 'handled', lines: [`Killed @${rest.replace(/^@/, '')}.`] };
    } catch (error) {
      return { kind: 'handled', lines: [error instanceof Error ? error.message : String(error)] };
    }
  }

  // Otherwise treat `/swarm <task>` as starting/continuing a swarm coordinator turn.
  const selection = state.workspace ? createWorkspaceSelection(state.threadId, state.workspace) : null;
  const started = swarmManager.startSwarm({
    coordinatorThreadId: state.threadId,
    title: clipLine(trimmed, 48),
    providerType: state.providerType,
    ...(state.providerId ? { providerId: state.providerId } : {}),
    model: state.model,
    workspaceSelection: selection,
  });

  return {
    kind: 'run-swarm',
    prompt: trimmed,
    swarmId: started.swarm.id,
    created: started.created,
  };
};
