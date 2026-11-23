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
  type EditorTheme,
  type MarkdownTheme,
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
  summarizeToolArgs,
  switchModel,
  type InteractiveCliState,
  type UsageTotals,
} from './commands';
import { openSearchablePickerOverlay } from './selectors';

export { createWorkspaceSelection, type InteractiveCliState } from './commands';

const SENDER_ID = 1;
const useColor = Boolean(output.isTTY) && !process.env.NO_COLOR;
const ansi = (code: string, text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const dim = (text: string) => ansi('2', text);
const bold = (text: string) => ansi('1', text);
const italic = (text: string) => ansi('3', text);
const cyan = (text: string) => ansi('36', text);
const green = (text: string) => ansi('32', text);
const yellow = (text: string) => ansi('33', text);
const red = (text: string) => ansi('31', text);
const userBg = (text: string) => (useColor ? `\x1b[48;5;236m${text}\x1b[49m` : text);
const selectedRow = (text: string) => (useColor ? `\x1b[48;5;24m\x1b[97;1m${text}\x1b[0m` : text);

const MARKDOWN_THEME: MarkdownTheme = {
  heading: text => bold(cyan(text)),
  link: text => cyan(text),
  linkUrl: text => dim(text),
  code: text => yellow(text),
  codeBlock: text => text,
  codeBlockBorder: text => dim(text),
  quote: text => dim(text),
  quoteBorder: text => dim(text),
  hr: text => dim(text),
  listBullet: text => cyan(text),
  bold: text => bold(text),
  italic: text => italic(text),
  strikethrough: text => ansi('9', text),
  underline: text => ansi('4', text),
};

const createEditorTheme = (isBusy: () => boolean): EditorTheme => ({
  borderColor: text => (isBusy() ? dim(text) : cyan(text)),
  selectList: {
    selectedPrefix: text => bold(cyan(text)),
    selectedText: text => selectedRow(text),
    description: text => dim(text),
    scrollInfo: text => dim(text),
    noMatch: text => dim(text),
  },
});

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

const runTuiInteractiveCli = async (state: InteractiveCliState): Promise<void> => {
  const totals: UsageTotals = { turns: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
  const terminal = new ProcessTerminal();
  const tui = new TuiMainScreen(terminal, true);
  tui.setClearOnShrink(true);

  const transcript = new Container();
  const loaderSlot = new Container();
  const statusText = new Text('', 1, 0);

  let activeTurn = false;
  let idleInterruptAt = 0;
  let stopped = false;
  let currentLoader: Loader | null = null;

  const refreshStatus = () => {
    const modelLabel = state.providerId ? `${state.providerId}/${state.model}` : state.model;
    const hint = activeTurn ? 'esc interrupt' : '/ cmd · @ file · ^c quit';
    statusText.setText(
      dim(
        `${modelLabel} · ${state.threadId} · t:${totals.turns} · ${totals.inputTokens}in/${totals.cacheReadTokens}c  |  ${hint}`
      )
    );
  };

  const editor = new Editor(tui, createEditorTheme(() => activeTurn), {
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
      new Markdown(prompt, 1, 1, MARKDOWN_THEME, { bgColor: userBg })
    );
    transcript.addChild(new Spacer(1));
  };

  const appendInfoBlock = (lines: string[], colorFn: (s: string) => string = s => s) => {
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
        new Text(dim(`... (${view.messages.length - tail.length} earlier message(s))`), 1, 0)
      );
      transcript.addChild(new Spacer(1));
    }
    for (const msg of tail) {
      const text = extractUiText(msg.parts);
      if (!text) continue;
      if (msg.role === 'user') {
        appendUserMessage(text);
      } else {
        transcript.addChild(new Markdown(text, 1, 0, MARKDOWN_THEME));
        transcript.addChild(new Spacer(1));
      }
    }
  };

  const bannerLines = await formatBannerLines(state);
  appendInfoBlock(bannerLines, dim);
  renderResumedTail(state.threadId);
  refreshStatus();

  tui.addChild(transcript);
  tui.addChild(loaderSlot);
  tui.addChild(editor);
  tui.addChild(statusText);
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
    refreshStatus();
    const startedAt = Date.now();
    let reasoningBuf = '';
    let textBuf = '';
    let aborted = false;
    let turnUsage: { inputTokens?: number; cacheReadTokens?: number; outputTokens?: number } | undefined;

    appendUserMessage(prompt);

    // Mount turn slots in-place inside `transcript` on first data so streaming
    // never jumps between containers and never leaves empty spacer lines.
    const turnContainer = new Container();
    transcript.addChild(turnContainer);

    let reasoningView: Text | null = null;
    let toolView: Text | null = null;
    let markdownView: Markdown | null = null;
    const toolLines: string[] = [];

    const loader = new Loader(tui, cyan, dim, 'Thinking...');
    currentLoader = loader;
    loaderSlot.addChild(loader);
    loader.start();
    tui.requestRender();

    const ensureReasoningView = () => {
      if (reasoningView) return reasoningView;
      reasoningView = new Text('', 1, 0);
      turnContainer.addChild(reasoningView);
      return reasoningView;
    };

    const ensureToolView = () => {
      if (toolView) return toolView;
      toolView = new Text('', 1, 0);
      turnContainer.addChild(toolView);
      return toolView;
    };

    const ensureMarkdownView = () => {
      if (markdownView) return markdownView;
      markdownView = new Markdown('', 1, 0, MARKDOWN_THEME);
      turnContainer.addChild(markdownView);
      return markdownView;
    };

    const target: ChatStreamTarget = {
      id: SENDER_ID,
      send: (channel: string, payload: unknown) => {
        if (channel !== 'chat:ui-chunk' || !payload || typeof payload !== 'object') return;
        const chunk = payload as Record<string, unknown>;
        if (chunk.type === 'reasoning-delta' && typeof chunk.delta === 'string') {
          reasoningBuf += chunk.delta;
          const tail = reasoningBuf.replace(/\s+/g, ' ').trim();
          const preview = tail.length > 140 ? `...${tail.slice(-137)}` : tail;
          ensureReasoningView().setText(dim(`[thinking] ${preview}`));
          tui.requestRender();
        } else if (chunk.type === 'text-delta' && typeof chunk.delta === 'string') {
          textBuf += chunk.delta;
          ensureMarkdownView().setText(textBuf);
          tui.requestRender();
        } else if (chunk.type === 'tool-input-available' && typeof chunk.toolName === 'string') {
          const args = summarizeToolArgs(chunk.input);
          loader.setMessage(`Running ${chunk.toolName}...`);
          toolLines.push(`${yellow('•')} ${bold(chunk.toolName)} ${dim(args)}`);
          ensureToolView().setText(toolLines.join('\n'));
          tui.requestRender();
        } else if (chunk.type === 'tool-output-available' && typeof chunk.toolName === 'string') {
          loader.setMessage('Thinking...');
          toolLines.push(`  ${green('✓')} ${dim(chunk.toolName)}`);
          ensureToolView().setText(toolLines.join('\n'));
          tui.requestRender();
        } else if (chunk.type === 'tool-output-error' && typeof chunk.toolName === 'string') {
          const err = typeof chunk.errorText === 'string' ? chunk.errorText : 'failed';
          loader.setMessage('Thinking...');
          toolLines.push(`  ${red('✗')} ${chunk.toolName}: ${red(err)}`);
          ensureToolView().setText(toolLines.join('\n'));
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

      if (!textBuf && 'text' in result && typeof result.text === 'string' && result.text.trim()) {
        ensureMarkdownView().setText(result.text);
      }
      if (aborted) {
        turnContainer.addChild(new Text(yellow('[interrupted]'), 1, 0));
      } else if (!result.success && 'error' in result && result.error) {
        turnContainer.addChild(new Text(red(`[error] ${result.error}`), 1, 0));
      }

      totals.turns += 1;
      if (turnUsage) {
        totals.inputTokens += turnUsage.inputTokens ?? 0;
        totals.cacheReadTokens += turnUsage.cacheReadTokens ?? 0;
        totals.outputTokens += turnUsage.outputTokens ?? 0;
        const sec = ((Date.now() - startedAt) / 1000).toFixed(1);
        turnContainer.addChild(
          new Text(
            dim(
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
      const message = error instanceof Error ? error.message : String(error);
      turnContainer.addChild(new Text(red(`[error] ${message}`), 1, 0));
      transcript.addChild(new Spacer(1));
    } finally {
      activeTurn = false;
      editor.disableSubmit = false;
      refreshStatus();
      tui.requestRender();
    }
  };

  let finishPromiseResolve: (() => void) | null = null;
  const donePromise = new Promise<void>(resolve => {
    finishPromiseResolve = resolve;
  });

  const createPickerTheme = () => ({
    title: (text: string) => bold(cyan(text)),
    dim,
    border: (text: string) => dim(text),
    panelBg: userBg,
    selectList: createEditorTheme(() => activeTurn).selectList,
  });

  const openModelPicker = async () => {
    const models = collectEnabledModels(state);
    if (models.length === 0) {
      appendInfoBlock(['No enabled models in models.toml.'], yellow);
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
      appendInfoBlock([switchModel(picked.value, state)], green);
    }
  };

  const openThreadPicker = async () => {
    const threads = state.chatService.listThreads().slice(0, 30);
    if (threads.length === 0) {
      appendInfoBlock(['No saved threads found.'], dim);
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
      appendInfoBlock(await formatBannerLines(state), dim);
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
      appendInfoBlock([`Set skillMode = ${state.skillMode}`], green);
    } else if (picked.data.kind === 'clear') {
      state.skills = undefined;
      appendInfoBlock(['Cleared explicit skill selection'], green);
    } else {
      const current = new Set(state.skills ?? []);
      if (current.has(picked.data.id)) current.delete(picked.data.id);
      else current.add(picked.data.id);
      state.skills = [...current];
      state.skillMode = 'manual';
      appendInfoBlock([`Pinned skills: ${state.skills.length ? state.skills.join(', ') : '(none)'}`], green);
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
      appendInfoBlock(outcome.lines, dim);
    } else if (state.threadId !== previousThreadId) {
      transcript.clear();
      appendInfoBlock(await formatBannerLines(state), dim);
      renderResumedTail(state.threadId);
    } else if (outcome.kind === 'handled') {
      appendInfoBlock(outcome.lines, dim);
    }
    refreshStatus();
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
      appendInfoBlock(['(Press Ctrl+C again or /exit to quit)'], dim);
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
            output.write(dim('[thinking] '));
            inReasoning = true;
          }
          output.write(dim(chunk.delta));
        } else if (chunk.type === 'text-delta' && typeof chunk.delta === 'string') {
          closeReasoning();
          if (!printedText) output.write('\n');
          printedText = true;
          output.write(chunk.delta);
        } else if (chunk.type === 'tool-input-available' && typeof chunk.toolName === 'string') {
          closeReasoning();
          output.write(`\n${yellow('•')} ${bold(chunk.toolName)} ${dim(summarizeToolArgs(chunk.input))}\n`);
        } else if (chunk.type === 'tool-output-available' && typeof chunk.toolName === 'string') {
          output.write(`  ${green('✓')} ${dim(chunk.toolName)}\n`);
        } else if (chunk.type === 'tool-output-error' && typeof chunk.toolName === 'string') {
          const err = typeof chunk.errorText === 'string' ? chunk.errorText : 'failed';
          output.write(`  ${red('✗')} ${chunk.toolName}: ${red(err)}\n`);
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
      output.write(`\n${red(`[error] ${result.error}`)}`);
    }
    output.write('\n');

    totals.turns += 1;
    if (turnUsage) {
      totals.inputTokens += turnUsage.inputTokens ?? 0;
      totals.cacheReadTokens += turnUsage.cacheReadTokens ?? 0;
      totals.outputTokens += turnUsage.outputTokens ?? 0;
      const sec = ((Date.now() - startedAt) / 1000).toFixed(1);
      output.write(
        dim(
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
