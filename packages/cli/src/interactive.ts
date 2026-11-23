import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  Loader,
  Markdown,
  ProcessTerminal,
  Spacer,
  Text,
  TuiMainScreen,
  matchesKey,
  visibleWidth,
  type Component,
} from '@earendil-works/pi-tui';
import type { ChatStreamTarget } from '@iki/harness/thread_session';
import { rebuildThreadViewFromEvents } from '@iki/harness/thread_session/session_log';
import { listSkills } from '@iki/harness/tools/skills';
import {
  buildSlashCommands,
  collectEnabledModels,
  createWorkspaceSelection,
  ensureThreadExists,
  executeSlashCommand,
  formatBannerLines,
  switchModel,
  type InteractiveCliState,
  type UsageTotals,
} from './commands';
import { openSearchablePickerOverlay } from './selectors';
import { cliMarkdownTheme, cliTheme, createCliEditorTheme, selectListTheme } from './theme';
import { formatToolCallPipedSummary } from './tool_render';
import { TurnView } from './turn_view';

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

class CliFooter implements Component {
  private leftTop = '';
  private leftBottom = '';
  private rightBottom = '';

  update(params: { leftTop: string; leftBottom: string; rightBottom: string }): void {
    this.leftTop = params.leftTop;
    this.leftBottom = params.leftBottom;
    this.rightBottom = params.rightBottom;
  }

  invalidate(): void {
    /* stateless formatting */
  }

  render(width: number): readonly string[] {
    const line1 = ` ${cliTheme.dim(this.leftTop)}`;
    const leftText = cliTheme.dim(this.leftBottom);
    const rightText = cliTheme.muted(this.rightBottom);
    const gap = width - 2 - visibleWidth(this.leftBottom) - visibleWidth(this.rightBottom);
    const line2 =
      gap >= 2
        ? ` ${leftText}${' '.repeat(gap)}${rightText} `
        : ` ${leftText}  ${rightText}`;
    return [line1, line2];
  }
}

const buildTurnStreamRequest = (state: InteractiveCliState, prompt: string) => {
  const history = state.chatService.listMessages(state.threadId);
  const userMessage = {
    id: `msg_${randomUUID()}`,
    role: 'user' as const,
    parts: [{ type: 'text' as const, text: prompt }],
  };
  return {
    threadId: state.threadId,
    providerType: state.providerType,
    ...(state.providerId ? { providerId: state.providerId } : {}),
    model: state.model,
    ...(state.tools ? { tools: state.tools } : {}),
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
  const totals: UsageTotals = { turns: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
  const terminal = new ProcessTerminal();
  const tui = new TuiMainScreen(terminal, true);
  tui.setClearOnShrink(true);

  const transcript = new Container();
  const loaderSlot = new Container();
  const footer = new CliFooter();

  let activeTurn = false;
  let idleInterruptAt = 0;
  let stopped = false;
  let hideThinking = true;
  let currentLoader: Loader | null = null;
  let cachedWorkspace = state.workspace;
  let cachedBranch = resolveGitBranch(state.workspace);
  const turnViews: TurnView[] = [];

  const toggleThinkingVisibility = () => {
    hideThinking = !hideThinking;
    for (const view of turnViews) {
      view.setHideThinking(hideThinking);
    }
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
    const thinkFlag = hideThinking ? ' · Ctrl+T thinking' : ' · thinking:on';
    const leftBottom = `${state.threadId} · t:${totals.turns} · ${totals.inputTokens}in/${totals.cacheReadTokens}c${compactFlag}${thinkFlag}`;
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

  tui.addChild(transcript);
  tui.addChild(loaderSlot);
  tui.addChild(editor);
  tui.addChild(footer);
  tui.setFocus(editor);

  const stopAll = () => {
    if (stopped) return;
    stopped = true;
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
    let turnUsage: { inputTokens?: number; cacheReadTokens?: number; outputTokens?: number } | undefined;

    appendUserMessage(prompt);

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
          tui.requestRender();
        } else if (chunk.type === 'tool-output-available') {
          const callId = typeof chunk.toolCallId === 'string' ? chunk.toolCallId : '';
          turnView.completeTool(callId, chunk.output);
          loader.setMessage('Working...');
          tui.requestRender();
        } else if (chunk.type === 'tool-output-error') {
          const callId = typeof chunk.toolCallId === 'string' ? chunk.toolCallId : '';
          const err = typeof chunk.errorText === 'string' ? chunk.errorText : 'failed';
          turnView.failTool(callId, err);
          loader.setMessage('Working...');
          tui.requestRender();
        } else if (chunk.type === 'abort') {
          aborted = true;
        } else if (chunk.type === 'data-token-usage' && chunk.data && typeof chunk.data === 'object') {
          const data = chunk.data as Record<string, unknown>;
          turnUsage = {
            ...(typeof data.inputTokens === 'number' ? { inputTokens: data.inputTokens } : {}),
            ...(typeof data.cacheReadTokens === 'number' ? { cacheReadTokens: data.cacheReadTokens } : {}),
            ...(typeof data.outputTokens === 'number' ? { outputTokens: data.outputTokens } : {}),
          };
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
        totals.inputTokens += turnUsage.inputTokens ?? 0;
        totals.cacheReadTokens += turnUsage.cacheReadTokens ?? 0;
        totals.outputTokens += turnUsage.outputTokens ?? 0;
        const sec = ((Date.now() - startedAt) / 1000).toFixed(1);
        turnView.addChild(new Spacer(1));
        turnView.addChild(
          new Text(
            cliTheme.dim(
              `[in ${turnUsage.inputTokens ?? 0} · cache ${turnUsage.cacheReadTokens ?? 0} · out ${turnUsage.outputTokens ?? 0} · ${sec}s]`
            ),
            1,
            0
          )
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

  const createPickerTheme = () => ({
    title: (text: string) => cliTheme.bold(cliTheme.borderAccent(text)),
    dim: cliTheme.dim,
    panelBg: cliTheme.panelBg,
    selectList: selectListTheme,
  });

  const openModelPicker = async () => {
    const models = collectEnabledModels(state);
    if (models.length === 0) {
      appendInfoBlock(['No enabled models in models.toml.'], cliTheme.warning);
      return;
    }
    const picked = await openSearchablePickerOverlay({
      tui,
      title: 'Switch Model',
      subtitle: 'Select an enabled provider/model from models.toml',
      items: models.map(m => ({
        value: m.qualified,
        label: `${m.active ? '* ' : '  '}${m.qualified}`,
        description: m.providerType,
        data: m,
      })),
      initialValue: models.find(m => m.active)?.qualified,
      theme: createPickerTheme(),
    });
    if (picked) {
      appendInfoBlock([switchModel(picked.value, state)], cliTheme.success);
    }
  };

  const openThreadPicker = async () => {
    const threads = state.chatService.listThreads().slice(0, 30);
    if (threads.length === 0) {
      appendInfoBlock(['No saved threads found.'], cliTheme.dim);
      return;
    }
    const picked = await openSearchablePickerOverlay({
      tui,
      title: 'Resume Thread',
      subtitle: 'Choose a thread to inspect and continue',
      items: threads.map(t => ({
        value: t.id,
        label: `${t.id === state.threadId ? '* ' : '  '}${t.id}`,
        description: `${t.title}${t.model ? ` (${t.model})` : ''}`,
        data: t,
      })),
      initialValue: state.threadId,
      theme: createPickerTheme(),
    });
    if (picked && picked.value !== state.threadId) {
      state.threadId = picked.value;
      ensureThreadExists(state, state.threadId, 'Interactive CLI');
      transcript.clear();
      turnViews.length = 0;
      await appendBanner();
      renderResumedTail(state.threadId);
    }
  };

  const openSkillPicker = async () => {
    type SkillPickerAction =
      | { kind: 'mode'; mode: 'auto' | 'manual' }
      | { kind: 'clear' }
      | { kind: 'skill'; id: string };
    const available = await listSkills();
    const picked = await openSearchablePickerOverlay<SkillPickerAction>({
      tui,
      title: `Skills (mode: ${state.skillMode})`,
      subtitle: 'Toggle a pinned skill or switch skillMode',
      items: [
        {
          value: '__mode:auto',
          label: `${state.skillMode === 'auto' ? '* ' : '  '}mode: auto`,
          description: 'Automatically select relevant skills per turn',
          data: { kind: 'mode', mode: 'auto' },
        },
        {
          value: '__mode:manual',
          label: `${state.skillMode === 'manual' ? '* ' : '  '}mode: manual`,
          description: 'Use only pinned skills',
          data: { kind: 'mode', mode: 'manual' },
        },
        {
          value: '__clear',
          label: '  clear pinned skills',
          description: 'Remove explicit skill pins',
          data: { kind: 'clear' },
        },
        ...available.map(s => ({
          value: s.id,
          label: `${state.skills?.includes(s.id) ? '* ' : '  '}${s.id}`,
          description: `[${s.source}] ${s.description ?? s.name}`,
          data: { kind: 'skill' as const, id: s.id },
        })),
      ],
      theme: createPickerTheme(),
    });
    if (!picked) return;
    if (picked.data.kind === 'mode') {
      state.skillMode = picked.data.mode;
      appendInfoBlock([`Set skillMode = ${state.skillMode}`], cliTheme.success);
    } else if (picked.data.kind === 'clear') {
      state.skills = undefined;
      appendInfoBlock(['Cleared explicit skill selection'], cliTheme.success);
    } else {
      const current = new Set(state.skills ?? []);
      if (current.has(picked.data.id)) current.delete(picked.data.id);
      else current.add(picked.data.id);
      state.skills = [...current];
      state.skillMode = 'manual';
      appendInfoBlock(
        [`Pinned skills: ${state.skills.length ? state.skills.join(', ') : '(none)'}`],
        cliTheme.success
      );
    }
  };

  const handleSubmittedText = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    editor.addToHistory(raw);
    editor.setText('');
    tui.requestRender();

    if (!trimmed.startsWith('/')) {
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
    } else if (outcome.kind === 'clear') {
      transcript.clear();
      turnViews.length = 0;
      appendInfoBlock(outcome.lines, styleBannerLine);
    } else if (state.threadId !== previousThreadId) {
      transcript.clear();
      turnViews.length = 0;
      await appendBanner();
      renderResumedTail(state.threadId);
    } else if (outcome.kind === 'handled') {
      appendInfoBlock(outcome.lines, cliTheme.muted);
    }
    refreshFooter();
    tui.requestRender();
  };

  editor.onSubmit = text => {
    if (activeTurn) return;
    void handleSubmittedText(text);
  };

  tui.addInputListener(data => {
    if (matchesKey(data, 'ctrl+c')) {
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
    if (matchesKey(data, 'escape') && activeTurn) {
      interruptActiveTurn();
      return { consume: true };
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

const runPipedInteractiveCli = async (state: InteractiveCliState): Promise<void> => {
  const totals: UsageTotals = { turns: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
  const slashNames = buildSlashCommands(state).map(c => `/${c.name}`);

  const runTurn = async (prompt: string) => {
    const startedAt = Date.now();
    let inReasoning = false;
    let printedText = false;
    let turnUsage: { inputTokens?: number; cacheReadTokens?: number; outputTokens?: number } | undefined;

    const closeReasoning = () => {
      if (!inReasoning) return;
      output.write('\n');
      inReasoning = false;
    };

    const target: ChatStreamTarget = {
      id: SENDER_ID,
      send: (channel: string, payload: unknown) => {
        if (channel !== 'chat:ui-chunk' || !payload || typeof payload !== 'object') return;
        const chunk = payload as Record<string, unknown>;
        if (chunk.type === 'reasoning-delta' && typeof chunk.delta === 'string') {
          if (!inReasoning) {
            output.write(cliTheme.dim('[thinking] '));
            inReasoning = true;
          }
          output.write(cliTheme.dim(chunk.delta));
        } else if (chunk.type === 'text-delta' && typeof chunk.delta === 'string') {
          closeReasoning();
          if (!printedText) output.write('\n');
          printedText = true;
          output.write(chunk.delta);
        } else if (chunk.type === 'tool-input-available' && typeof chunk.toolName === 'string') {
          closeReasoning();
          output.write(
            `\n${cliTheme.warning('•')} ${cliTheme.bold(chunk.toolName)} ${cliTheme.dim(formatToolCallPipedSummary(chunk.toolName, chunk.input))}\n`
          );
        } else if (chunk.type === 'tool-output-available' && typeof chunk.toolName === 'string') {
          output.write(`  ${cliTheme.success('✓')} ${cliTheme.dim(chunk.toolName)}\n`);
        } else if (chunk.type === 'tool-output-error' && typeof chunk.toolName === 'string') {
          const err = typeof chunk.errorText === 'string' ? chunk.errorText : 'failed';
          output.write(`  ${cliTheme.error('✗')} ${chunk.toolName}: ${cliTheme.error(err)}\n`);
        } else if (chunk.type === 'data-token-usage' && chunk.data && typeof chunk.data === 'object') {
          const data = chunk.data as Record<string, unknown>;
          turnUsage = {
            ...(typeof data.inputTokens === 'number' ? { inputTokens: data.inputTokens } : {}),
            ...(typeof data.cacheReadTokens === 'number' ? { cacheReadTokens: data.cacheReadTokens } : {}),
            ...(typeof data.outputTokens === 'number' ? { outputTokens: data.outputTokens } : {}),
          };
        }
      },
    };

    const result = await state.chatService.stream(target, buildTurnStreamRequest(state, prompt));
    closeReasoning();
    if (!printedText && 'text' in result && typeof result.text === 'string' && result.text.trim()) {
      output.write(`\n${result.text}`);
    }
    if (!result.success && 'error' in result && result.error) {
      output.write(`\n${cliTheme.error(`[error] ${result.error}`)}`);
    }
    output.write('\n');

    totals.turns += 1;
    if (turnUsage) {
      totals.inputTokens += turnUsage.inputTokens ?? 0;
      totals.cacheReadTokens += turnUsage.cacheReadTokens ?? 0;
      totals.outputTokens += turnUsage.outputTokens ?? 0;
      const sec = ((Date.now() - startedAt) / 1000).toFixed(1);
      output.write(
        cliTheme.dim(
          `  [in ${turnUsage.inputTokens ?? 0} · cache ${turnUsage.cacheReadTokens ?? 0} · out ${turnUsage.outputTokens ?? 0} · ${sec}s]`
        ) + '\n'
      );
    }
    output.write('\n');
  };

  const rl = readline.createInterface({
    input,
    output,
    terminal: false,
    completer: (line: string): [string[], string] => {
      if (!line.startsWith('/')) return [[], line];
      const hits = slashNames.filter(cmd => cmd.startsWith(line));
      return [hits.length ? hits : slashNames, line];
    },
  });

  const pendingLines: string[] = [];
  let eof = false;
  let lineWaiter: (() => void) | null = null;
  rl.on('line', (line: string) => {
    pendingLines.push(line);
    if (lineWaiter) {
      const wake = lineWaiter;
      lineWaiter = null;
      wake();
    }
  });
  rl.on('close', () => {
    eof = true;
    if (lineWaiter) {
      const wake = lineWaiter;
      lineWaiter = null;
      wake();
    }
  });

  output.write(`\n${(await formatBannerLines(state)).join('\n')}\n\n`);
  if (state.initialPrompt) {
    await runTurn(state.initialPrompt);
  }

  while (!eof || pendingLines.length > 0) {
    while (pendingLines.length === 0) {
      if (eof) return rl.close();
      await new Promise<void>(resolve => {
        lineWaiter = resolve;
      });
    }
    const line = pendingLines.shift();
    if (line === undefined) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith('/')) {
      await runTurn(trimmed);
      continue;
    }
    const outcome = await executeSlashCommand(trimmed, state, totals);
    if (outcome.kind === 'exit') break;
    if ('lines' in outcome) {
      output.write(`\n${outcome.lines.join('\n')}\n\n`);
    }
  }
  rl.close();
};

export const runInteractiveCli = async (state: InteractiveCliState): Promise<void> => {
  ensureThreadExists(state, state.threadId, 'Interactive CLI');
  if (Boolean(input.isTTY) && Boolean(output.isTTY)) {
    await runTuiInteractiveCli(state);
    return;
  }
  await runPipedInteractiveCli(state);
};
