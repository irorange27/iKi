import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { stdin as input, stdout as output } from 'node:process';
import {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  Loader,
  Markdown,
  ProcessTerminal,
  ScrollView,
  Spacer,
  Text,
  TuiAltScreen,
  VStack,
  matchesKey,
} from '@earendil-works/pi-tui';
import type { ChatStreamTarget } from '@iki/harness/thread_session';
import { rebuildThreadViewFromEvents } from '@iki/harness/thread_session/session_log';
import { buildCoordinatorSystemPrompt } from '@iki/harness/swarm';
import { getBuiltinToolNames } from '@iki/harness/tools';
import { formatSwarmBadge, formatSwarmBoardEntryLine } from './swarm_commands';
import {
  accumulateUsageTotals,
  buildSlashCommands,
  countThreadTurnsAndSteps,
  createWorkspaceSelection,
  ensureThreadExists,
  executeSlashCommand,
  extractTurnTokenUsage,
  formatBannerLines,
  formatTurnUsageBadge,
  pruneEmptyThreadIfUnused,
  type InteractiveCliState,
  type TurnTokenUsage,
  type UsageTotals,
} from './commands';
import { copyToClipboard, readClipboardFilePaths, readClipboardText } from './clipboard';
import { cliMarkdownTheme, cliTheme, createCliEditorTheme } from './theme';
import { JobLiveTracker, LiveActivityStrip, SwarmLiveTracker } from './live_monitor';
import { LiveWatchController } from './live_views';
import { runPipedInteractiveCli } from './piped';
import { createTuiPickers } from './tui_pickers';
import { CliFooter, TurnView } from './turn_view';

export { createWorkspaceSelection, type InteractiveCliState } from './commands';

const SENDER_ID = 1;

const resolveGitBranch = (cwd?: string): string | null => {
  if (!cwd) return null;
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 800,
    }).trim();
    return branch || null;
  } catch {
    return null;
  }
};

const formatDisplayPath = (targetPath?: string): string => {
  if (!targetPath) return '';
  const home = os.homedir();
  return targetPath === home || targetPath.startsWith(`${home}/`)
    ? `~${targetPath.slice(home.length)}`
    : targetPath;
};

const buildTurnStreamRequest = (state: InteractiveCliState, prompt: string) => {
  const history = state.chatService.listMessages(state.threadId);
  const userMessage = {
    id: `msg_${randomUUID()}`,
    role: 'user' as const,
    parts: [{ type: 'text' as const, text: prompt }],
  };
  const activeSwarm = state.swarmManager?.getSwarmForThread(state.threadId);
  const effectiveTools = activeSwarm
    ? [...new Set([...(state.tools ?? getBuiltinToolNames()), 'swarm'])]
    : state.tools;
  return {
    threadId: state.threadId,
    providerType: state.providerType,
    ...(state.providerId ? { providerId: state.providerId } : {}),
    model: state.model,
    ...(effectiveTools ? { tools: effectiveTools } : {}),
    ...(activeSwarm ? { extraSystemPrompt: buildCoordinatorSystemPrompt(activeSwarm.id) } : {}),
    ...(state.skills ? { skillIds: state.skills } : {}),
    skillMode: state.skillMode,
    ...(state.workspace
      ? { workspaceSelection: createWorkspaceSelection(state.threadId, state.workspace) }
      : {}),
    messages: [...history, userMessage],
  };
};

const extractUiText = (parts: unknown): string => {
  if (!Array.isArray(parts)) return '';
  return parts
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
};

const styleBannerLine = (line: string): string => {
  if (line.startsWith('[') && line.endsWith(']')) return cliTheme.bold(cliTheme.accent(line));
  if (line.startsWith('iKi CLI')) return cliTheme.bold(cliTheme.text(line));
  if (line.startsWith('Shortcuts:')) return cliTheme.dim(line);
  return cliTheme.muted(line);
};

const runTuiInteractiveCli = async (state: InteractiveCliState): Promise<void> => {
  const totals: UsageTotals = { turns: 0, uncachedInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
  const terminal = new ProcessTerminal();
  const tui = new TuiAltScreen(terminal, true, undefined, {
    wheelScrollLines: 'auto',
    mouse: true,
    copyOnSelect: true,
    copySelection: async text => {
      try {
        await copyToClipboard(text);
        return true;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    onRightClickPaste: () => {
      void handleRightClickPaste();
    },
    scrollToEndIndicator: () => cliTheme.dim(' ↓ Jump to bottom '),
  });
  const handleRightClickPaste = async () => {
    const target = tui.getFocusedComponent();
    const handleInput = target?.handleInput;
    if (!target || !handleInput) return;
    try {
      const text = await readClipboardText();
      if (!text || tui.getFocusedComponent() !== target) return;
      const safeText = text.replaceAll('\x1b[201~', '');
      handleInput.call(target, `\x1b[200~${safeText}\x1b[201~`);
      tui.requestRender();
    } catch {
      // Ignore clipboard access errors on right-click paste.
    }
  };
  tui.setClearOnShrink(true);

  const watchHeaderSlot = new Container();
  const transcript = new Container();
  const watchTranscript = new Container();
  const viewportContent = new Container();
  viewportContent.addChild(transcript);
  const loaderSlot = new Container();
  const footer = new CliFooter();

  const swarmTracker = new SwarmLiveTracker(state.swarmManager, () => state.threadId);
  const jobTracker = new JobLiveTracker(() => {
    const ids = new Set([state.threadId]);
    const swarm = state.swarmManager?.getSwarmForThread(state.threadId);
    if (swarm) for (const m of Object.values(swarm.members)) ids.add(m.threadId);
    return ids;
  });
  const activityStrip = new LiveActivityStrip(swarmTracker, jobTracker);

  let activeTurn = false;
  let selectorOpen = false;
  let idleInterruptAt = 0;
  let stopped = false;
  let hideThinking = true;
  let currentLoader: Loader | null = null;
  let cachedWorkspace = state.workspace;
  let cachedBranch = resolveGitBranch(state.workspace);
  const turnViews: TurnView[] = [];
  let watchController: LiveWatchController | null = null;

  const toggleThinkingVisibility = () => {
    hideThinking = !hideThinking;
    for (const view of turnViews) {
      view.setHideThinking(hideThinking);
    }
    swarmTracker.setHideThinking(hideThinking);
    watchController?.setHideThinking(hideThinking);
    refreshFooter();
    tui.requestRender();
  };

  const refreshFooter = () => {
    if (state.workspace !== cachedWorkspace) {
      cachedWorkspace = state.workspace;
      cachedBranch = resolveGitBranch(state.workspace);
    }
    const view = rebuildThreadViewFromEvents(state.threadId);
    const modelLabel = state.providerId ? `${state.providerId}/${state.model}` : state.model;
    const pathPart = formatDisplayPath(state.workspace) || state.dataDir;
    const leftTop = cachedBranch ? `${pathPart} (${cachedBranch})` : pathPart;
    const compactFlag = view.compaction ? ' · compacted' : '';
    const swarmBadge = formatSwarmBadge(state.swarmManager, state.threadId);
    const swarmFlag = swarmBadge ? ` · ${swarmBadge}` : '';
    const runningJobs = jobTracker.getRunningCount();
    const jobFlag = runningJobs > 0 ? ` · jobs:${runningJobs}` : '';
    const watchMode = watchController?.getMode();
    const watchFlag =
      watchMode?.kind === 'swarm-member'
        ? ` · watching:@${watchMode.memberName}`
        : watchMode?.kind === 'swarm-board'
          ? ' · watching:board'
          : watchMode?.kind === 'job-log'
            ? ` · watching:${watchMode.jobId}`
            : '';
    const thinkFlag = hideThinking ? ' · Ctrl+T thinking' : ' · thinking:on';
    const { turns: threadTurns, steps: modelSteps } = countThreadTurnsAndSteps(
      state.threadId,
      view.messages
    );
    const leftBottom = `${state.threadId} · turn:${threadTurns}/step:${modelSteps} · ${totals.uncachedInputTokens}in/${totals.cacheReadTokens}c${compactFlag}${swarmFlag}${jobFlag}${watchFlag}${thinkFlag}`;
    footer.update({
      leftTop,
      leftBottom,
      rightBottom: activeTurn ? `working · ${modelLabel}` : modelLabel,
    });
  };

  const editor = new Editor(tui, createCliEditorTheme(() => activeTurn), {
    paddingX: 1,
    autocompleteMaxVisible: 10,
  });
  const autocomplete = new CombinedAutocompleteProvider(
    buildSlashCommands(state),
    state.workspace ?? process.cwd()
  );
  editor.setAutocompleteProvider(autocomplete);

  const appendUserMessage = (prompt: string) => {
    transcript.addChild(
      new Markdown(prompt, 1, 1, cliMarkdownTheme, {
        color: cliTheme.text,
        bgColor: cliTheme.userBg,
      })
    );
    transcript.addChild(new Spacer(1));
  };

  const appendBanner = async () => {
    const lines = await formatBannerLines(state);
    transcript.addChild(new Text(lines.map(styleBannerLine).join('\n'), 1, 0));
    transcript.addChild(new Spacer(1));
  };

  const appendInfoBlock = (lines: string[], colorFn: (s: string) => string = cliTheme.muted) => {
    if (lines.length === 0) return;
    transcript.addChild(new Text(lines.map(colorFn).join('\n'), 1, 0));
    transcript.addChild(new Spacer(1));
    tui.requestRender();
  };

  const renderResumedTail = (threadId: string) => {
    const view = rebuildThreadViewFromEvents(threadId);
    const tail = view.messages.slice(-6);
    if (tail.length === 0) return;
    if (view.messages.length > tail.length) {
      transcript.addChild(
        new Text(cliTheme.dim(`... (${view.messages.length - tail.length} earlier message(s))`), 1, 0)
      );
      transcript.addChild(new Spacer(1));
    }
    for (const msg of tail) {
      if (msg.role === 'user') {
        const text = extractUiText(msg.parts);
        if (!text) continue;
        appendUserMessage(text);
      } else {
        const viewComponent = new TurnView({ hideThinking });
        viewComponent.hydratePersistedParts(Array.isArray(msg.parts) ? msg.parts : []);
        turnViews.push(viewComponent);
        transcript.addChild(viewComponent);
        transcript.addChild(new Spacer(1));
      }
    }
  };

  await appendBanner();
  renderResumedTail(state.threadId);
  refreshFooter();

  const transcriptScroll = new ScrollView(viewportContent, {
    follow: 'end',
    primary: true,
    overscroll: 'chain',
    scrollbar: 'auto',
    scrollbarTrackStyle: text => cliTheme.borderMuted(text),
    scrollbarThumbStyle: text => cliTheme.borderAccent(text),
  });
  watchController = new LiveWatchController({
    swarmManager: state.swarmManager,
    swarmTracker,
    getThreadId: () => state.threadId,
    headerSlot: watchHeaderSlot,
    viewportContent,
    mainTranscript: transcript,
    watchTranscript,
    scrollToEnd: () => transcriptScroll.scrollToEnd(),
    requestRender: () => tui.requestRender(),
    onModeChanged: mode => {
      activityStrip.setWatchedTarget({
        memberName: mode.kind === 'swarm-member' ? mode.memberName : null,
        jobId: mode.kind === 'job-log' ? mode.jobId : null,
      });
      refreshFooter();
    },
  });
  const editorContainer = new Container();
  editorContainer.addChild(editor);

  const dock = new VStack([
    { component: activityStrip, shrink: 1, minSize: 0 },
    { component: loaderSlot, shrink: 1, minSize: 0 },
    { component: editorContainer, shrink: 1, minSize: 3 },
    { component: footer, shrink: 1, minSize: 0 },
  ]);
  const layoutRoot = new VStack([
    { component: watchHeaderSlot, basis: 'auto', grow: 0, shrink: 0, minSize: 0 },
    { component: transcriptScroll, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: dock, basis: 'auto', grow: 0, shrink: 1, minSize: 1 },
  ]);

  tui.addChild(watchHeaderSlot);
  tui.addChild(viewportContent);
  tui.addChild(activityStrip);
  tui.addChild(loaderSlot);
  tui.addChild(editorContainer);
  tui.addChild(footer);
  tui.setLayoutRoot(layoutRoot);
  tui.setFocus(editor);

  const stopSwarmBoardSub = state.swarmManager?.onBoardEntry(entry => {
    const active = state.swarmManager?.getSwarmForThread(state.threadId);
    if (!active || active.id !== entry.swarmId) return;
    watchController?.onBoardEntry(entry);
    if (entry.sender === 'coordinator' || entry.sender === 'user') return;
    appendInfoBlock([formatSwarmBoardEntryLine(entry)], cliTheme.dim);
    refreshFooter();
  });
  const stopSwarmStateSub = state.swarmManager?.onMemberStateChange(evt => {
    const active = state.swarmManager?.getSwarmForThread(state.threadId);
    if (!active || active.id !== evt.swarmId) return;
    refreshFooter();
    tui.requestRender();
  });
  const stopTrackerChange = swarmTracker.onChange(() => {
    refreshFooter();
    tui.requestRender();
  });
  const stopTrackerReset = swarmTracker.onMemberTurnReset(name => {
    watchController?.onMemberTurnReset(name);
  });
  const liveTimer = setInterval(() => {
    if (stopped) return;
    const mode = watchController?.getMode().kind ?? 'main';
    const busy = swarmTracker.hasWorkingMembers() || jobTracker.getVisibleStripJobs().length > 0 || mode !== 'main';
    if (!busy) return;
    watchController?.tick();
    refreshFooter();
    tui.requestRender();
  }, 1000);
  liveTimer.unref();

  const stopAll = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(liveTimer);
    stopSwarmBoardSub?.();
    stopSwarmStateSub?.();
    stopTrackerChange();
    stopTrackerReset();
    swarmTracker.dispose();
    currentLoader?.stop();
    tui.stop();
  };

  const interruptActiveTurn = () => {
    if (!activeTurn) return;
    state.chatService.stopStream(SENDER_ID);
    currentLoader?.setMessage('Stopping...');
    tui.requestRender();
  };

  const runTurn = async (prompt: string) => {
    activeTurn = true;
    editor.disableSubmit = true;
    refreshFooter();
    const startedAt = Date.now();
    let aborted = false;
    let turnUsage: TurnTokenUsage | undefined;

    appendUserMessage(prompt);
    transcriptScroll.scrollToEnd();

    const turnView = new TurnView({ hideThinking });
    turnViews.push(turnView);
    transcript.addChild(turnView);

    const loader = new Loader(tui, cliTheme.borderAccent, cliTheme.dim, 'Working...');
    currentLoader = loader;
    loaderSlot.addChild(loader);
    loader.start();
    tui.requestRender();

    let toolCounter = 0;

    const target: ChatStreamTarget = {
      id: SENDER_ID,
      send: (channel: string, payload: unknown) => {
        if (channel !== 'chat:ui-chunk' || !payload || typeof payload !== 'object') return;
        const chunk = payload as Record<string, unknown>;
        if (chunk.type === 'reasoning-delta' && typeof chunk.delta === 'string') {
          turnView.appendReasoningDelta(chunk.delta);
          loader.setMessage('Thinking...');
          tui.requestRender();
        } else if (chunk.type === 'text-delta' && typeof chunk.delta === 'string') {
          turnView.appendTextDelta(chunk.delta);
          loader.setMessage('Responding...');
          tui.requestRender();
        } else if (chunk.type === 'tool-input-available' && typeof chunk.toolName === 'string') {
          const callId =
            typeof chunk.toolCallId === 'string' ? chunk.toolCallId : `${chunk.toolName}-${toolCounter++}`;
          turnView.addToolPending(callId, chunk.toolName, chunk.input);
          loader.setMessage(`Running ${chunk.toolName}...`);
          refreshFooter();
          tui.requestRender();
        } else if (chunk.type === 'tool-output-available') {
          const callId = typeof chunk.toolCallId === 'string' ? chunk.toolCallId : '';
          turnView.completeTool(callId, chunk.output);
          loader.setMessage('Working...');
          refreshFooter();
          tui.requestRender();
        } else if (chunk.type === 'tool-output-error') {
          const callId = typeof chunk.toolCallId === 'string' ? chunk.toolCallId : '';
          const err = typeof chunk.errorText === 'string' ? chunk.errorText : 'failed';
          turnView.failTool(callId, err);
          loader.setMessage('Working...');
          refreshFooter();
          tui.requestRender();
        } else if (chunk.type === 'abort') {
          aborted = true;
        } else if (chunk.type === 'data-token-usage' && chunk.data && typeof chunk.data === 'object') {
          turnUsage = extractTurnTokenUsage(chunk.data as Record<string, unknown>);
        }
      },
    };

    try {
      const result = await state.chatService.stream(target, buildTurnStreamRequest(state, prompt));
      loader.stop();
      loaderSlot.clear();
      currentLoader = null;

      turnView.finishTurn('text' in result && typeof result.text === 'string' ? result.text : undefined);
      if (aborted) {
        turnView.addChild(new Spacer(1));
        turnView.addChild(new Text(cliTheme.warning('[interrupted]'), 1, 0));
      } else if (!result.success && 'error' in result && result.error) {
        turnView.addChild(new Spacer(1));
        turnView.addChild(new Text(cliTheme.error(`[error] ${result.error}`), 1, 0));
      }

      totals.turns += 1;
      if (turnUsage) {
        accumulateUsageTotals(totals, turnUsage);
        const sec = ((Date.now() - startedAt) / 1000).toFixed(1);
        turnView.addChild(new Spacer(1));
        turnView.addChild(
          new Text(cliTheme.dim(formatTurnUsageBadge(turnUsage, sec)), 1, 0)
        );
      }
      transcript.addChild(new Spacer(1));
    } catch (error) {
      loader.stop();
      loaderSlot.clear();
      currentLoader = null;
      turnView.finishTurn();
      const message = error instanceof Error ? error.message : String(error);
      turnView.addChild(new Spacer(1));
      turnView.addChild(new Text(cliTheme.error(`[error] ${message}`), 1, 0));
      transcript.addChild(new Spacer(1));
    } finally {
      activeTurn = false;
      editor.disableSubmit = false;
      refreshFooter();
      tui.requestRender();
    }
  };

  let finishPromiseResolve: (() => void) | null = null;
  const donePromise = new Promise<void>(resolve => {
    finishPromiseResolve = resolve;
  });

  const {
    openModelPicker,
    openThreadPicker,
    openSkillPicker,
    openSwarmPicker,
    openJobPicker,
  } = createTuiPickers({
    tui,
    state,
    editorContainer,
    editor,
    swarmTracker,
    jobTracker,
    getWatchController: () => watchController,
    setSelectorOpen: open => {
      selectorOpen = open;
    },
    appendInfoBlock,
    flash: (msg, ms) => tui.flash(msg, ms),
    onThreadSwitched: async () => {
      tui.resetTextSelection();
      transcript.clear();
      turnViews.length = 0;
      await appendBanner();
      renderResumedTail(state.threadId);
      transcriptScroll.scrollToEnd();
    },
  });

  const handleSubmittedText = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    editor.addToHistory(raw);
    editor.setText('');
    tui.requestRender();

    if (!trimmed.startsWith('/')) {
      const mode = watchController?.getMode();
      if (mode?.kind === 'swarm-member' && state.swarmManager) {
        try {
          const out = state.swarmManager.steerMember(mode.swarmId, mode.memberName, trimmed);
          tui.flash(`Steered @${mode.memberName} (${out.delivered})`, 2200);
        } catch (error) {
          tui.flash(error instanceof Error ? error.message : String(error), 2500);
        }
        return;
      }
      if (mode?.kind === 'swarm-board' && state.swarmManager) {
        try {
          const posted = state.swarmManager.postAsUser(mode.swarmId, trimmed);
          const woke = posted.woken.length ? ` · woke ${posted.woken.map(m => `@${m}`).join(', ')}` : '';
          tui.flash(`Posted #${posted.seq}${woke}`, 2200);
        } catch (error) {
          tui.flash(error instanceof Error ? error.message : String(error), 2500);
        }
        return;
      }
      if (mode?.kind === 'job-log') {
        tui.flash('Viewing job log — press Esc to return to chat or Ctrl+K to kill job', 2500);
        return;
      }
      await runTurn(raw);
      return;
    }

    const previousThreadId = state.threadId;
    const outcome = await executeSlashCommand(trimmed, state, totals, { interactivePickers: true });
    if (outcome.kind === 'exit') {
      stopAll();
      finishPromiseResolve?.();
      return;
    }
    if (outcome.kind === 'pick-model') {
      await openModelPicker();
    } else if (outcome.kind === 'pick-thread') {
      await openThreadPicker();
    } else if (outcome.kind === 'pick-skill') {
      await openSkillPicker();
    } else if (outcome.kind === 'pick-job') {
      await openJobPicker();
    } else if (outcome.kind === 'watch-swarm') {
      await openSwarmPicker(outcome.target);
    } else if (outcome.kind === 'run-swarm') {
      watchController?.returnToMain();
      appendInfoBlock(
        [
          `${outcome.created ? 'Started' : 'Continuing'} swarm ${outcome.swarmId} as @coordinator.`,
        ],
        cliTheme.success
      );
      await runTurn(outcome.prompt);
      return;
    } else if (outcome.kind === 'clear') {
      watchController?.returnToMain();
      tui.resetTextSelection();
      transcript.clear();
      turnViews.length = 0;
      appendInfoBlock(outcome.lines, styleBannerLine);
      transcriptScroll.scrollToEnd();
    } else if (state.threadId !== previousThreadId) {
      watchController?.returnToMain();
      tui.resetTextSelection();
      transcript.clear();
      turnViews.length = 0;
      await appendBanner();
      renderResumedTail(state.threadId);
      transcriptScroll.scrollToEnd();
    } else if (outcome.kind === 'handled') {
      watchController?.returnToMain();
      appendInfoBlock(outcome.lines, cliTheme.muted);
    }
    refreshFooter();
    tui.requestRender();
  };

  editor.onSubmit = text => {
    if (activeTurn) return;
    void handleSubmittedText(text);
  };

  const handleClipboardPaste = async () => {
    try {
      const filePaths = await readClipboardFilePaths();
      if (filePaths && filePaths.length > 0) {
        editor.insertTextAtCursor(filePaths.join('\n'));
        tui.requestRender();
        return;
      }
      const text = await readClipboardText();
      if (text) {
        editor.insertTextAtCursor(text);
        tui.requestRender();
      }
    } catch (error) {
      tui.flash(error instanceof Error ? error.message : 'Clipboard paste failed', 2500);
    }
  };

  tui.addInputListener(data => {
    if (
      matchesKey(data, 'ctrl+v') ||
      matchesKey(data, 'ctrl+shift+v') ||
      matchesKey(data, 'super+v')
    ) {
      if (selectorOpen) {
        void handleRightClickPaste();
      } else {
        void handleClipboardPaste();
      }
      return { consume: true };
    }
    if (
      (matchesKey(data, 'ctrl+shift+c') || matchesKey(data, 'super+c')) &&
      tui.hasActiveSelection()
    ) {
      void tui.copyActiveSelectionToClipboard();
      return { consume: true };
    }
    if (selectorOpen) return undefined;
    if (matchesKey(data, 'ctrl+c')) {
      if (tui.hasActiveSelection()) {
        void tui.copyActiveSelectionToClipboard();
        return { consume: true };
      }
      if (activeTurn) {
        interruptActiveTurn();
        return { consume: true };
      }
      if (editor.getText().length > 0) {
        editor.setText('');
        tui.requestRender();
        return { consume: true };
      }
      const now = Date.now();
      if (now - idleInterruptAt < 1500) {
        stopAll();
        finishPromiseResolve?.();
        return { consume: true };
      }
      idleInterruptAt = now;
      appendInfoBlock(['(Press Ctrl+C again or /exit to quit)'], cliTheme.dim);
      return { consume: true };
    }
    if (matchesKey(data, 'ctrl+t')) {
      toggleThinkingVisibility();
      return { consume: true };
    }
    if (matchesKey(data, 'ctrl+w')) {
      void openSwarmPicker();
      return { consume: true };
    }
    if (matchesKey(data, 'ctrl+j')) {
      void openJobPicker();
      return { consume: true };
    }
    if (matchesKey(data, 'ctrl+k') && watchController?.getMode().kind === 'job-log') {
      void watchController.killWatchedJob().then(msg => {
        if (msg) tui.flash(msg, 2400);
        refreshFooter();
        tui.requestRender();
      });
      return { consume: true };
    }
    if (matchesKey(data, 'escape')) {
      if (activeTurn) {
        interruptActiveTurn();
        return { consume: true };
      }
      if (watchController && watchController.getMode().kind !== 'main') {
        watchController.returnToMain();
        return { consume: true };
      }
    }
    if (matchesKey(data, 'ctrl+d') && !activeTurn && editor.getText().length === 0) {
      stopAll();
      finishPromiseResolve?.();
      return { consume: true };
    }
    return undefined;
  });

  tui.start();
  if (state.initialPrompt) {
    await runTurn(state.initialPrompt);
  }
  await donePromise;
};

export const runInteractiveCli = async (state: InteractiveCliState): Promise<void> => {
  ensureThreadExists(state, state.threadId, 'Interactive CLI');
  try {
    if (Boolean(input.isTTY) && Boolean(output.isTTY)) {
      await runTuiInteractiveCli(state);
      return;
    }
    await runPipedInteractiveCli(state, SENDER_ID, buildTurnStreamRequest);
  } finally {
    pruneEmptyThreadIfUnused(state, state.threadId);
  }
};
