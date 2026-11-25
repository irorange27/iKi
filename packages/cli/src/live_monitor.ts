import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui';
import type {
  SwarmBoardEntry,
  SwarmManager,
  SwarmMemberStatus,
  SwarmMemberStreamEvent,
} from '@iki/harness/swarm';
import {
  listShellJobs,
  readBoundedLogSlice,
  type ShellJobRecord,
} from '@iki/tools/shell';
import { cliTheme } from './theme';
import { formatToolCallPipedSummary } from './tool_render';
import { TurnView } from './turn_view';

type MemberLivePhase = 'idle' | 'thinking' | 'tool' | 'responding' | 'error';

export type MemberLiveState = {
  memberName: string;
  threadId: string;
  role: 'coordinator' | 'worker';
  status: SwarmMemberStatus;
  phase: MemberLivePhase;
  workingSinceMs?: number;
  lastDurationMs?: number;
  activeTool?: string;
  lastSummary?: string;
  lastError?: string;
  activeTurnView: TurnView | null;
  activeTurnStartedAt?: number;
  toolCounter: number;
};

export type TrackedJobSummary = {
  job: ShellJobRecord;
  elapsedMs: number;
  lastLine: string;
  recentNotice: boolean;
};

const RECENT_JOB_WINDOW_MS = 20_000;

const clipOneLine = (text: string, max = 72): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
};

export const formatCompactElapsed = (ms: number): string => {
  const safe = Math.max(0, Math.floor(ms / 1000));
  if (safe < 60) return `${safe}s`;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  if (mins < 60) return `${mins}m${secs.toString().padStart(2, '0')}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h${(mins % 60).toString().padStart(2, '0')}m`;
};

const readLastLogLine = (logPath: string): string => {
  const slice = readBoundedLogSlice(logPath, { maxBytes: 2048, maxLines: 6 });
  if (!slice.output) return '';
  const lines = slice.output
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  return lines.at(-1) ?? '';
};

export class SwarmLiveTracker {
  private readonly members = new Map<string, MemberLiveState>();
  private readonly unsubs: Array<() => void> = [];
  private readonly listeners = new Set<() => void>();
  private readonly turnListeners = new Set<(memberName: string) => void>();
  private hideThinking = true;

  constructor(
    private readonly swarmManager: SwarmManager | undefined,
    private readonly getThreadId: () => string
  ) {
    if (!swarmManager) return;

    this.unsubs.push(
      swarmManager.onMemberStateChange(evt => {
        const active = this.getActiveSwarm();
        if (!active || active.id !== evt.swarmId) return;
        const member = active.members[evt.memberName];
        if (!member) return;
        const state = this.ensureMember(evt.memberName, member.threadId, member.role, evt.change.current);
        state.status = evt.change.current;
        if (evt.change.current === 'working') {
          state.workingSinceMs = Date.now();
          state.phase = 'thinking';
          state.activeTool = undefined;
          state.lastError = undefined;
          if (member.role === 'worker') {
            state.activeTurnView = new TurnView({ hideThinking: this.hideThinking });
            state.activeTurnStartedAt = Date.now();
            this.notifyTurnReset(evt.memberName);
          }
        } else {
          if (state.workingSinceMs) {
            state.lastDurationMs = Date.now() - state.workingSinceMs;
          }
          state.workingSinceMs = undefined;
          state.activeTool = undefined;
          if (evt.change.reason === 'turn-error') {
            state.phase = 'error';
          } else {
            state.phase = 'idle';
          }
          if (state.activeTurnView) {
            state.activeTurnView.finishTurn();
            state.activeTurnView = null;
            this.notifyTurnReset(evt.memberName);
          }
        }
        this.emit();
      })
    );

    this.unsubs.push(
      swarmManager.onMemberStreamEvent(evt => this.handleStreamEvent(evt))
    );

    this.unsubs.push(
      swarmManager.onBoardEntry(entry => this.handleBoardEntry(entry))
    );
  }

  private getActiveSwarm() {
    if (!this.swarmManager) return null;
    return this.swarmManager.getSwarmForThread(this.getThreadId());
  }

  private ensureMember(
    memberName: string,
    threadId: string,
    role: 'coordinator' | 'worker',
    status: SwarmMemberStatus
  ): MemberLiveState {
    let existing = this.members.get(memberName);
    if (!existing || existing.threadId !== threadId) {
      existing = {
        memberName,
        threadId,
        role,
        status,
        phase: status === 'working' ? 'thinking' : 'idle',
        activeTurnView: null,
        toolCounter: 0,
      };
      this.members.set(memberName, existing);
    } else {
      existing.status = status;
    }
    return existing;
  }

  private handleBoardEntry(entry: SwarmBoardEntry): void {
    const active = this.getActiveSwarm();
    if (!active || active.id !== entry.swarmId) return;
    const member = active.members[entry.sender];
    if (member) {
      const state = this.ensureMember(member.name, member.threadId, member.role, member.status);
      state.lastSummary = clipOneLine(entry.content, 64);
    }
    this.emit();
  }

  private handleStreamEvent(evt: SwarmMemberStreamEvent): void {
    const active = this.getActiveSwarm();
    if (!active || active.id !== evt.swarmId) return;
    if (evt.channel !== 'chat:ui-chunk' || !evt.payload || typeof evt.payload !== 'object') return;
    const member = active.members[evt.memberName];
    if (!member) return;

    const state = this.ensureMember(evt.memberName, evt.threadId, member.role, 'working');
    if (!state.workingSinceMs) state.workingSinceMs = Date.now();
    if (member.role === 'worker' && !state.activeTurnView) {
      state.activeTurnView = new TurnView({ hideThinking: this.hideThinking });
      state.activeTurnStartedAt = Date.now();
      this.notifyTurnReset(evt.memberName);
    }

    const chunk = evt.payload as Record<string, unknown>;
    if (chunk.type === 'reasoning-delta' && typeof chunk.delta === 'string') {
      state.phase = 'thinking';
      state.activeTurnView?.appendReasoningDelta(chunk.delta);
    } else if (chunk.type === 'text-delta' && typeof chunk.delta === 'string') {
      state.phase = 'responding';
      state.activeTurnView?.appendTextDelta(chunk.delta);
      const nextPreview = clipOneLine(`${state.lastSummary ?? ''}${chunk.delta}`, 64);
      if (chunk.delta.trim()) state.lastSummary = nextPreview;
    } else if (chunk.type === 'tool-input-available' && typeof chunk.toolName === 'string') {
      const callId =
        typeof chunk.toolCallId === 'string'
          ? chunk.toolCallId
          : `${chunk.toolName}-${state.toolCounter++}`;
      const summary = formatToolCallPipedSummary(chunk.toolName, chunk.input);
      state.phase = 'tool';
      state.activeTool = clipOneLine(summary ? `${chunk.toolName} ${summary}` : chunk.toolName, 56);
      state.activeTurnView?.addToolPending(callId, chunk.toolName, chunk.input);
    } else if (chunk.type === 'tool-output-available') {
      const callId = typeof chunk.toolCallId === 'string' ? chunk.toolCallId : '';
      state.activeTurnView?.completeTool(callId, chunk.output);
      state.phase = 'thinking';
      state.activeTool = undefined;
    } else if (chunk.type === 'tool-output-error') {
      const callId = typeof chunk.toolCallId === 'string' ? chunk.toolCallId : '';
      const err = typeof chunk.errorText === 'string' ? chunk.errorText : 'tool failed';
      state.activeTurnView?.failTool(callId, err);
      state.phase = 'error';
      state.lastError = clipOneLine(err, 56);
      state.activeTool = undefined;
    } else {
      return;
    }

    this.emit();
  }

  setHideThinking(hide: boolean): void {
    this.hideThinking = hide;
    for (const state of this.members.values()) {
      state.activeTurnView?.setHideThinking(hide);
    }
  }

  getMemberState(memberName: string): MemberLiveState | undefined {
    return this.members.get(memberName);
  }

  hasWorkingMembers(): boolean {
    const active = this.getActiveSwarm();
    if (!active || !this.swarmManager) return false;
    const view = this.swarmManager.status({ callerThreadId: this.getThreadId() });
    return view.members.some(m => m.status === 'working' || m.pendingEvents > 0);
  }

  getSnapshot() {
    const active = this.getActiveSwarm();
    if (!active || !this.swarmManager) return null;
    const statusView = this.swarmManager.status({ callerThreadId: this.getThreadId() });
    const members = statusView.members.map(m => {
      const live = this.ensureMember(m.name, m.threadId, m.role, m.status);
      return { statusView: m, live };
    });
    return { statusView, members };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onMemberTurnReset(listener: (memberName: string) => void): () => void {
    this.turnListeners.add(listener);
    return () => this.turnListeners.delete(listener);
  }

  private notifyTurnReset(memberName: string): void {
    for (const listener of this.turnListeners) listener(memberName);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    this.listeners.clear();
    this.turnListeners.clear();
  }
}

export class JobLiveTracker {
  private readonly seenStatuses = new Map<string, string>();
  private readonly noticedUntil = new Map<string, number>();

  constructor(
    private readonly getRelevantThreadIds: () => Set<string>
  ) {}

  getJobs(): TrackedJobSummary[] {
    const now = Date.now();
    const relevantThreads = this.getRelevantThreadIds();
    const all = listShellJobs();
    const out: TrackedJobSummary[] = [];

    for (const job of all) {
      const prevStatus = this.seenStatuses.get(job.jobId);
      if (prevStatus === 'running' && job.status !== 'running') {
        this.noticedUntil.set(job.jobId, now + RECENT_JOB_WINDOW_MS);
      }
      this.seenStatuses.set(job.jobId, job.status);

      const isRelevant =
        job.status === 'running' ||
        !job.threadId ||
        relevantThreads.has(job.threadId);
      if (!isRelevant) continue;

      const startedMs = Date.parse(job.startedAt || '') || now;
      const finishedMs = job.finishedAt ? Date.parse(job.finishedAt) || now : now;
      const elapsedMs = Math.max(0, (job.status === 'running' ? now : finishedMs) - startedMs);
      const noticeDeadline = this.noticedUntil.get(job.jobId) ?? 0;
      const recentlyFinished =
        job.status !== 'running' &&
        (now < noticeDeadline || (job.finishedAt ? now - finishedMs < RECENT_JOB_WINDOW_MS : false));

      out.push({
        job,
        elapsedMs,
        lastLine: job.status === 'running' || recentlyFinished ? readLastLogLine(job.logPath) : '',
        recentNotice: recentlyFinished,
      });
    }

    return out.sort((a, b) => {
      if (a.job.status === 'running' && b.job.status !== 'running') return -1;
      if (a.job.status !== 'running' && b.job.status === 'running') return 1;
      return (b.job.startedAt || '').localeCompare(a.job.startedAt || '');
    });
  }

  getVisibleStripJobs(): TrackedJobSummary[] {
    return this.getJobs().filter(item => item.job.status === 'running' || item.recentNotice);
  }

  getRunningCount(): number {
    return this.getJobs().filter(item => item.job.status === 'running').length;
  }
}

export class LiveActivityStrip implements Component {
  private watchedMemberName: string | null = null;
  private watchedJobId: string | null = null;

  constructor(
    private readonly swarmTracker: SwarmLiveTracker,
    private readonly jobTracker: JobLiveTracker
  ) {}

  setWatchedTarget(params: { memberName?: string | null; jobId?: string | null }): void {
    this.watchedMemberName = params.memberName ?? null;
    this.watchedJobId = params.jobId ?? null;
  }

  invalidate(): void {
    /* dynamic width-based rendering */
  }

  render(width: number): readonly string[] {
    if (width <= 8) return [];
    const lines: string[] = [];
    const inner = Math.max(1, width - 2);
    const now = Date.now();

    const swarmSnap = this.swarmTracker.getSnapshot();
    if (swarmSnap) {
      const { statusView, members } = swarmSnap;
      const workers = members.filter(m => m.statusView.role === 'worker');
      const workingCount = workers.filter(m => m.statusView.status === 'working').length;
      const waitingCount = workers.filter(m => m.statusView.status === 'waiting').length;
      const titleText = clipOneLine(statusView.title, 28);
      const headerLeft = ` Swarm: ${titleText} (${workingCount}w/${waitingCount}i · ${statusView.totalTurns}/${statusView.maxTotalTurns}t · #${statusView.latestSeq})`;
      const headerRight = 'Ctrl+W watch · Ctrl+J jobs ';
      const headerGap = Math.max(1, width - visibleWidth(headerLeft) - visibleWidth(headerRight));
      const header =
        visibleWidth(headerLeft) + visibleWidth(headerRight) + 1 <= width
          ? `${cliTheme.bold(cliTheme.accent(headerLeft))}${' '.repeat(headerGap)}${cliTheme.dim(headerRight)}`
          : cliTheme.bold(cliTheme.accent(headerLeft));
      lines.push(cliTheme.panelBg(truncateToWidth(header, width)));

      const prioritized = [...workers].sort((a, b) => {
        const rank = (s: SwarmMemberStatus, name: string) =>
          name === this.watchedMemberName ? 0 : s === 'working' ? 1 : s === 'waiting' ? 2 : 3;
        return rank(a.statusView.status, a.statusView.name) - rank(b.statusView.status, b.statusView.name);
      });
      const shown = prioritized.slice(0, 4);

      for (const { statusView: mv, live } of shown) {
        const marker = mv.name === this.watchedMemberName ? cliTheme.borderAccent('▸') : ' ';
        const icon =
          mv.status === 'working'
            ? cliTheme.warning('●')
            : live.phase === 'error'
              ? cliTheme.error('✗')
              : mv.status === 'waiting'
                ? cliTheme.success('○')
                : cliTheme.dim('×');
        const elapsed =
          mv.status === 'working' && live.workingSinceMs
            ? ` ${formatCompactElapsed(now - live.workingSinceMs)}`
            : '';
        const statusTag =
          mv.status === 'working'
            ? cliTheme.warning(`[working${elapsed}]`)
            : mv.status === 'waiting'
              ? cliTheme.dim('[waiting]')
              : cliTheme.dim(`[${mv.status}]`);

        let activity = '';
        if (mv.status === 'working') {
          if (live.activeTool) activity = cliTheme.accent(`⚡ ${live.activeTool}`);
          else if (live.phase === 'responding' && live.lastSummary) activity = cliTheme.text(`✎ ${live.lastSummary}`);
          else activity = cliTheme.thinking('… Thinking...');
        } else if (live.lastError) {
          activity = cliTheme.error(`✗ ${live.lastError}`);
        } else if (live.lastSummary) {
          activity = cliTheme.dim(live.lastSummary);
        } else if (mv.branch) {
          activity = cliTheme.dim(`${mv.workspaceMode} · ${mv.branch}`);
        } else {
          activity = cliTheme.dim(mv.workspaceMode);
        }

        const nameCol = `@${mv.name}`.padEnd(13);
        const row = `${marker}${icon} ${cliTheme.bold(cliTheme.text(nameCol))} ${statusTag} ${activity}`;
        lines.push(cliTheme.panelBg(truncateToWidth(` ${row}`, width)));
      }
      if (prioritized.length > shown.length) {
        lines.push(
          cliTheme.panelBg(
            truncateToWidth(cliTheme.dim(`   ... +${prioritized.length - shown.length} more worker(s) (Ctrl+W)`), width)
          )
        );
      }
    }

    const visibleJobs = this.jobTracker.getVisibleStripJobs();
    if (visibleJobs.length > 0) {
      const running = visibleJobs.filter(j => j.job.status === 'running').length;
      const jobHeader = running > 0
        ? ` Background Jobs (${running} running) · Ctrl+J tail/kill`
        : ` Background Jobs (recent) · Ctrl+J inspect`;
      lines.push(cliTheme.panelBg(truncateToWidth(cliTheme.bold(cliTheme.warning(jobHeader)), width)));

      for (const item of visibleJobs.slice(0, 3)) {
        const { job, elapsedMs, lastLine } = item;
        const marker = job.jobId === this.watchedJobId ? cliTheme.borderAccent('▸') : ' ';
        const icon =
          job.status === 'running'
            ? cliTheme.warning('⚡')
            : job.status === 'completed'
              ? cliTheme.success('✓')
              : cliTheme.error('✗');
        const stateTag =
          job.status === 'running'
            ? cliTheme.warning(`[${formatCompactElapsed(elapsedMs)}]`)
            : job.status === 'completed'
              ? cliTheme.success(`[done ${formatCompactElapsed(elapsedMs)}]`)
              : cliTheme.error(`[${job.status}${typeof job.exitCode === 'number' ? ` exit ${job.exitCode}` : ''}]`);
        const cmd = clipOneLine(job.command, Math.min(34, Math.max(16, Math.floor(inner * 0.3))));
        const tail = lastLine ? ` ${cliTheme.dim('│')} ${cliTheme.muted(clipOneLine(lastLine, 44))}` : '';
        const row = `${marker}${icon} ${cliTheme.text(job.jobId)} ${stateTag} ${cliTheme.dim(cmd)}${tail}`;
        lines.push(cliTheme.panelBg(truncateToWidth(` ${row}`, width)));
      }
    }

    return lines;
  }
}
