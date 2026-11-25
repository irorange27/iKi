import {
  Box,
  Container,
  Markdown,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
  type Component,
} from '@earendil-works/pi-tui';
import type { SwarmBoardEntry, SwarmManager } from '@iki/harness/swarm';
import { rebuildThreadViewFromEvents } from '@iki/harness/thread_session/session_log';
import {
  getShellJob,
  killShellJob,
  readBoundedLogSlice,
} from '@iki/tools/shell';
import {
  formatCompactElapsed,
  type JobLiveTracker,
  type SwarmLiveTracker,
} from './live_monitor';
import type { PickerOption } from './selectors';
import { cliMarkdownTheme, cliTheme } from './theme';
import { TurnView } from './turn_view';

export type WatchMode =
  | { kind: 'main' }
  | { kind: 'swarm-board'; swarmId: string }
  | { kind: 'swarm-member'; swarmId: string; memberName: string; threadId: string }
  | { kind: 'job-log'; jobId: string };

const formatShortTime = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toTimeString().slice(0, 8);
};

const summarizeWorkerInput = (parts: unknown): string => {
  if (!Array.isArray(parts)) return '';
  const raw = parts
    .filter(
      (part): part is { type: string; text: string } =>
        Boolean(part) &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
    )
    .map(p => p.text)
    .join('\n')
    .trim();
  if (!raw) return '';
  if (!raw.includes('<swarm_board_delta')) {
    return raw.length > 260 ? `${raw.slice(0, 257)}...` : raw;
  }
  const inner = raw
    .replace(/<swarm_board_delta[^>]*>/g, '')
    .replace(/<\/swarm_board_delta>[\s\S]*$/g, '')
    .trim();
  const lines = inner.split(/\r?\n/).slice(0, 6);
  const clipped = lines.join('\n');
  return clipped.length > 320 ? `${clipped.slice(0, 317)}...` : clipped;
};

class WatchHeaderBar implements Component {
  private left = '';
  private right = '';

  update(left: string, right: string): void {
    this.left = left;
    this.right = right;
  }

  invalidate(): void {
    /* dynamic width */
  }

  render(width: number): readonly string[] {
    if (width <= 2 || !this.left) return [];
    const leftW = visibleWidth(this.left);
    const rightW = visibleWidth(this.right);
    let line: string;
    if (leftW + rightW + 2 <= width) {
      line = `${this.left}${' '.repeat(width - leftW - rightW)}${this.right}`;
    } else {
      line = truncateToWidth(this.left, width);
    }
    return [
      cliTheme.selectedBg(truncateToWidth(line, width)),
      cliTheme.borderMuted('─'.repeat(Math.max(1, width))),
    ];
  }
}

export class LiveWatchController {
  private mode: WatchMode = { kind: 'main' };
  private hideThinking = true;
  private readonly watchTurnViews: TurnView[] = [];
  private readonly headerBar = new WatchHeaderBar();
  private lastJobFingerprint = '';
  private boardRenderedSeq = 0;

  constructor(private readonly deps: {
    swarmManager?: SwarmManager;
    swarmTracker: SwarmLiveTracker;
    getThreadId: () => string;
    headerSlot: Container;
    viewportContent: Container;
    mainTranscript: Container;
    watchTranscript: Container;
    scrollToEnd: () => void;
    requestRender: () => void;
    onModeChanged: (mode: WatchMode) => void;
  }) {}

  getMode(): WatchMode {
    return this.mode;
  }

  setHideThinking(hide: boolean): void {
    this.hideThinking = hide;
    for (const tv of this.watchTurnViews) {
      tv.setHideThinking(hide);
    }
  }

  private renderHeader(): void {
    this.deps.headerSlot.clear();
    if (this.mode.kind === 'main') return;

    if (this.mode.kind === 'swarm-board') {
      const swarm = this.deps.swarmManager?.getSwarm(this.mode.swarmId);
      const title = swarm?.title ?? this.mode.swarmId;
      this.headerBar.update(
        ` ${cliTheme.bold(cliTheme.accent('BOARD'))} ${cliTheme.bold(cliTheme.text(title))} ${cliTheme.dim('· type to post as user (@member wakes)')}`,
        `${cliTheme.dim('Ctrl+W switch · Esc back')} `
      );
    } else if (this.mode.kind === 'swarm-member') {
      const swarm = this.deps.swarmManager?.getSwarm(this.mode.swarmId);
      const member = swarm?.members[this.mode.memberName];
      const live = this.deps.swarmTracker.getMemberState(this.mode.memberName);
      const status = live?.status ?? member?.status ?? 'waiting';
      const elapsed =
        status === 'working' && live?.workingSinceMs
          ? ` ${formatCompactElapsed(Date.now() - live.workingSinceMs)}`
          : '';
      const statusBadge =
        status === 'working'
          ? cliTheme.warning(`● working${elapsed}`)
          : status === 'waiting'
            ? cliTheme.success('○ waiting')
            : cliTheme.dim(`× ${status}`);
      const branchPart = member?.branch ? ` · ${member.workspaceMode}:${member.branch}` : '';
      const modelPart = member ? ` · ${member.model}` : '';
      this.headerBar.update(
        ` ${cliTheme.bold(cliTheme.accent(`@${this.mode.memberName}`))} ${statusBadge}${cliTheme.dim(`${branchPart}${modelPart} · type to steer`)}`,
        `${cliTheme.dim('Ctrl+W switch · Esc back')} `
      );
    } else if (this.mode.kind === 'job-log') {
      const job = getShellJob(this.mode.jobId);
      const now = Date.now();
      const started = job?.startedAt ? Date.parse(job.startedAt) || now : now;
      const finished = job?.finishedAt ? Date.parse(job.finishedAt) || now : now;
      const elapsed = job ? formatCompactElapsed((job.status === 'running' ? now : finished) - started) : '0s';
      const statusBadge = !job
        ? cliTheme.error('not found')
        : job.status === 'running'
          ? cliTheme.warning(`⚡ running ${elapsed} · pid ${job.pid}`)
          : job.status === 'completed'
            ? cliTheme.success(`✓ completed ${elapsed} · exit ${job.exitCode ?? 0}`)
            : cliTheme.error(`✗ ${job.status} ${elapsed}${typeof job.exitCode === 'number' ? ` · exit ${job.exitCode}` : ''}`);
      this.headerBar.update(
        ` ${cliTheme.bold(cliTheme.warning('JOB'))} ${cliTheme.bold(cliTheme.text(this.mode.jobId))} ${statusBadge}`,
        `${cliTheme.dim(job?.status === 'running' ? 'Ctrl+K kill · Ctrl+J switch · Esc back' : 'Ctrl+J switch · Esc back')} `
      );
    }

    this.deps.headerSlot.addChild(this.headerBar);
  }

  private activateWatchContainer(): void {
    this.deps.viewportContent.clear();
    this.deps.viewportContent.addChild(this.deps.watchTranscript);
    this.renderHeader();
    this.deps.scrollToEnd();
    this.deps.requestRender();
  }

  returnToMain(): void {
    if (this.mode.kind === 'main') return;
    this.mode = { kind: 'main' };
    this.watchTurnViews.length = 0;
    this.lastJobFingerprint = '';
    this.boardRenderedSeq = 0;
    this.deps.watchTranscript.clear();
    this.deps.headerSlot.clear();
    this.deps.viewportContent.clear();
    this.deps.viewportContent.addChild(this.deps.mainTranscript);
    this.deps.onModeChanged(this.mode);
    this.deps.scrollToEnd();
    this.deps.requestRender();
  }

  openSwarmBoard(swarmId: string): void {
    this.mode = { kind: 'swarm-board', swarmId };
    this.watchTurnViews.length = 0;
    this.boardRenderedSeq = 0;
    this.deps.watchTranscript.clear();

    const entries = this.deps.swarmManager?.readBoard(swarmId, { limit: 80 }) ?? [];
    if (entries.length === 0) {
      this.deps.watchTranscript.addChild(
        new Text(cliTheme.dim('Shared board is empty.'), 1, 0)
      );
    } else {
      for (const entry of entries) {
        this.appendBoardEntryComponent(entry);
      }
    }

    this.deps.onModeChanged(this.mode);
    this.activateWatchContainer();
  }

  private appendBoardEntryComponent(entry: SwarmBoardEntry): void {
    if (entry.seq <= this.boardRenderedSeq) return;
    this.boardRenderedSeq = entry.seq;

    const mentions =
      entry.mentions.length > 0
        ? ` ${cliTheme.dim('->')} ${entry.mentions.map(m => cliTheme.accent(`@${m}`)).join(' ')}`
        : '';
    const timePart = formatShortTime(entry.createdAt);
    const kindStyle =
      entry.kind === 'system'
        ? cliTheme.dim
        : entry.kind === 'brief'
          ? cliTheme.warning
          : cliTheme.success;
    const header = `${cliTheme.dim(`#${entry.seq}`)} ${kindStyle(`[${entry.kind}]`)} ${cliTheme.bold(cliTheme.text(`@${entry.sender}`))}${mentions}${timePart ? `  ${cliTheme.dim(timePart)}` : ''}`;

    const box = new Box(1, 0, entry.kind === 'system' ? cliTheme.panelBg : cliTheme.toolPendingBg);
    box.addChild(new Text(header, 0, 0));
    box.addChild(new Markdown(entry.content, 0, 0, cliMarkdownTheme, { color: cliTheme.text }));
    this.deps.watchTranscript.addChild(box);
    this.deps.watchTranscript.addChild(new Spacer(1));
  }

  onBoardEntry(entry: SwarmBoardEntry): void {
    if (this.mode.kind !== 'swarm-board' || this.mode.swarmId !== entry.swarmId) return;
    if (this.boardRenderedSeq === 0) {
      this.deps.watchTranscript.clear();
    }
    this.appendBoardEntryComponent(entry);
    this.renderHeader();
    this.deps.scrollToEnd();
    this.deps.requestRender();
  }

  openSwarmMember(swarmId: string, memberName: string): boolean {
    const swarm = this.deps.swarmManager?.getSwarm(swarmId);
    const member = swarm?.members[memberName];
    if (!swarm || !member) return false;

    this.mode = {
      kind: 'swarm-member',
      swarmId,
      memberName: member.name,
      threadId: member.threadId,
    };
    this.rebuildWatchedMemberView();
    this.deps.onModeChanged(this.mode);
    this.activateWatchContainer();
    return true;
  }

  rebuildWatchedMemberView(): void {
    if (this.mode.kind !== 'swarm-member') return;
    this.watchTurnViews.length = 0;
    this.deps.watchTranscript.clear();

    const view = rebuildThreadViewFromEvents(this.mode.threadId);
    const tail = view.messages.slice(-10);
    if (view.messages.length > tail.length) {
      this.deps.watchTranscript.addChild(
        new Text(cliTheme.dim(`... (${view.messages.length - tail.length} earlier message(s))`), 1, 0)
      );
      this.deps.watchTranscript.addChild(new Spacer(1));
    }
    for (const msg of tail) {
      if (msg.role === 'user') {
        const preview = summarizeWorkerInput(msg.parts);
        if (!preview) continue;
        const box = new Box(1, 0, cliTheme.userBg);
        box.addChild(new Text(cliTheme.dim('▸ wakeup / directive'), 0, 0));
        box.addChild(new Text(cliTheme.text(preview), 0, 0));
        this.deps.watchTranscript.addChild(box);
        this.deps.watchTranscript.addChild(new Spacer(1));
      } else {
        const tv = new TurnView({ hideThinking: this.hideThinking });
        tv.hydratePersistedParts(Array.isArray(msg.parts) ? msg.parts : []);
        this.watchTurnViews.push(tv);
        this.deps.watchTranscript.addChild(tv);
        this.deps.watchTranscript.addChild(new Spacer(1));
      }
    }

    const live = this.deps.swarmTracker.getMemberState(this.mode.memberName);
    if (live?.activeTurnView) {
      live.activeTurnView.setHideThinking(this.hideThinking);
      this.watchTurnViews.push(live.activeTurnView);
      this.deps.watchTranscript.addChild(
        new Text(cliTheme.warning('● Live turn in progress...'), 1, 0)
      );
      this.deps.watchTranscript.addChild(live.activeTurnView);
      this.deps.watchTranscript.addChild(new Spacer(1));
    } else if (tail.length === 0) {
      this.deps.watchTranscript.addChild(
        new Text(cliTheme.dim(`@${this.mode.memberName} has no recorded messages yet.`), 1, 0)
      );
    }

    this.renderHeader();
    this.deps.scrollToEnd();
    this.deps.requestRender();
  }

  onMemberTurnReset(memberName: string): void {
    if (this.mode.kind === 'swarm-member' && this.mode.memberName === memberName) {
      this.rebuildWatchedMemberView();
    }
  }

  openJobLog(jobId: string): boolean {
    const job = getShellJob(jobId);
    if (!job) return false;
    this.mode = { kind: 'job-log', jobId: job.jobId };
    this.lastJobFingerprint = '';
    this.refreshWatchedJobLog(true);
    this.deps.onModeChanged(this.mode);
    this.activateWatchContainer();
    return true;
  }

  refreshWatchedJobLog(force = false): void {
    if (this.mode.kind !== 'job-log') return;
    const job = getShellJob(this.mode.jobId);
    if (!job) {
      this.renderHeader();
      this.deps.requestRender();
      return;
    }

    const slice = readBoundedLogSlice(job.logPath, { maxLines: 200, maxBytes: 24_000 });
    const fp = `${job.status}|${job.exitCode ?? ''}|${slice.totalBytes}|${job.status === 'running' ? Math.floor(Date.now() / 1000) : ''}`;
    if (!force && fp === this.lastJobFingerprint) return;
    this.lastJobFingerprint = fp;

    this.deps.watchTranscript.clear();
    const metaBox = new Box(1, 0, cliTheme.panelBg);
    metaBox.addChild(
      new Text(
        [
          `${cliTheme.dim('Command:')} ${cliTheme.bold(cliTheme.text(job.command))}`,
          `${cliTheme.dim('CWD:')}     ${cliTheme.muted(job.cwd)}`,
          `${cliTheme.dim('Log:')}     ${cliTheme.muted(job.logPath)} ${cliTheme.dim(`(${slice.totalBytes}B · showing ${slice.shownLines}/${slice.totalLines} lines)`)}`,
        ].join('\n'),
        0,
        0
      )
    );
    this.deps.watchTranscript.addChild(metaBox);
    this.deps.watchTranscript.addChild(new Spacer(1));

    if (slice.output) {
      if (slice.truncated) {
        this.deps.watchTranscript.addChild(
          new Text(cliTheme.dim(`... (earlier output truncated; showing last ${slice.shownLines} lines)`), 1, 0)
        );
      }
      this.deps.watchTranscript.addChild(new Text(cliTheme.text(slice.output), 1, 0));
    } else {
      this.deps.watchTranscript.addChild(
        new Text(
          cliTheme.dim(job.status === 'running' ? '(waiting for output...)' : '(no output recorded)'),
          1,
          0
        )
      );
    }

    this.renderHeader();
    this.deps.scrollToEnd();
    this.deps.requestRender();
  }

  async killWatchedJob(): Promise<string | null> {
    if (this.mode.kind !== 'job-log') return null;
    try {
      const res = await killShellJob(this.mode.jobId);
      this.refreshWatchedJobLog(true);
      return res.message;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  tick(): void {
    if (this.mode.kind === 'swarm-member') {
      this.renderHeader();
    } else if (this.mode.kind === 'job-log') {
      this.refreshWatchedJobLog(false);
    }
  }
}

export type SwarmWatchChoice =
  | { kind: 'main' }
  | { kind: 'board'; swarmId: string }
  | { kind: 'member'; swarmId: string; memberName: string };

export const buildSwarmWatchPickerItems = (
  swarmTracker: SwarmLiveTracker,
  currentMode: WatchMode
): { items: Array<PickerOption<SwarmWatchChoice>>; initialValue?: string } | null => {
  const snap = swarmTracker.getSnapshot();
  if (!snap) return null;
  const { statusView, members } = snap;
  const now = Date.now();
  const isMain = currentMode.kind === 'main';
  const isBoard = currentMode.kind === 'swarm-board';
  const items: Array<PickerOption<SwarmWatchChoice>> = [
    {
      value: '__main',
      label: `${isMain ? '* ' : '  '}Main (@coordinator)`,
      description: 'Return to primary conversation',
      data: { kind: 'main' },
    },
    {
      value: '__board',
      label: `${isBoard ? '* ' : '  '}Shared Board (live)`,
      description: `${statusView.latestSeq} post(s) · ${statusView.totalTurns}/${statusView.maxTotalTurns} turns`,
      data: { kind: 'board', swarmId: statusView.swarmId },
    },
  ];
  for (const { statusView: mv, live } of members.filter(m => m.statusView.role === 'worker')) {
    const active = currentMode.kind === 'swarm-member' && currentMode.memberName === mv.name;
    const icon = mv.status === 'working' ? '●' : mv.status === 'waiting' ? '○' : '×';
    const elapsed = mv.status === 'working' && live.workingSinceMs ? ` ${formatCompactElapsed(now - live.workingSinceMs)}` : '';
    const detail = mv.status === 'working'
      ? (live.activeTool ? `⚡ ${live.activeTool}` : live.phase === 'responding' ? '✎ writing' : '… thinking')
      : (live.lastSummary ?? (mv.branch ? `${mv.workspaceMode}:${mv.branch}` : mv.workspaceMode));
    items.push({
      value: `member:${mv.name}`,
      label: `${active ? '* ' : '  '}${icon} @${mv.name} [${mv.status}${elapsed}]`,
      description: detail,
      data: { kind: 'member', swarmId: statusView.swarmId, memberName: mv.name },
    });
  }
  const initialValue =
    currentMode.kind === 'swarm-member'
      ? `member:${currentMode.memberName}`
      : isBoard
        ? '__board'
        : '__main';
  return { items, initialValue };
};

export type JobWatchChoice = { kind: 'main' } | { kind: 'job'; jobId: string };

export const buildJobWatchPickerItems = (
  jobTracker: JobLiveTracker,
  currentMode: WatchMode
): { items: Array<PickerOption<JobWatchChoice>>; initialValue?: string } => {
  const jobs = jobTracker.getJobs().slice(0, 25);
  const items: Array<PickerOption<JobWatchChoice>> = [];
  if (currentMode.kind === 'job-log') {
    items.push({
      value: '__main',
      label: '  ← Back to main chat',
      description: 'Close live job log viewer',
      data: { kind: 'main' },
    });
  }
  for (const { job, elapsedMs, lastLine } of jobs) {
    const active = currentMode.kind === 'job-log' && currentMode.jobId === job.jobId;
    const icon = job.status === 'running' ? '⚡' : job.status === 'completed' ? '✓' : '✗';
    const exitPart = typeof job.exitCode === 'number' ? ` exit=${job.exitCode}` : '';
    const cmd = job.command.replace(/\s+/g, ' ').trim().slice(0, 48);
    items.push({
      value: job.jobId,
      label: `${active ? '* ' : '  '}${icon} ${job.jobId} [${job.status} ${formatCompactElapsed(elapsedMs)}${exitPart}]`,
      description: lastLine ? `${cmd} │ ${lastLine.slice(0, 40)}` : `${cmd} (pid ${job.pid})`,
      data: { kind: 'job', jobId: job.jobId },
    });
  }
  return {
    items,
    initialValue: currentMode.kind === 'job-log' ? currentMode.jobId : jobs[0]?.job.jobId,
  };
};
