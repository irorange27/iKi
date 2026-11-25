import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { ChatStreamTarget } from '@iki/harness/thread_session';
import type { ChatTurnOptions } from '@iki/harness/turn_prep/turn_preparer';
import {
  accumulateUsageTotals,
  buildSlashCommands,
  executeSlashCommand,
  extractTurnTokenUsage,
  formatBannerLines,
  formatTurnUsageBadge,
  type InteractiveCliState,
  type TurnTokenUsage,
  type UsageTotals,
} from './commands';
import { formatSwarmBoardEntryLine } from './swarm_commands';
import { cliTheme } from './theme';
import { formatToolCallPipedSummary } from './tool_render';

export const runPipedInteractiveCli = async (
  state: InteractiveCliState,
  senderId: number,
  buildTurnStreamRequest: (state: InteractiveCliState, prompt: string) => ChatTurnOptions
): Promise<void> => {
  const totals: UsageTotals = { turns: 0, uncachedInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
  const slashNames = buildSlashCommands(state).map(c => `/${c.name}`);

  const runTurn = async (prompt: string) => {
    const startedAt = Date.now();
    let inReasoning = false;
    let printedText = false;
    let turnUsage: TurnTokenUsage | undefined;

    const closeReasoning = () => {
      if (!inReasoning) return;
      output.write('\n');
      inReasoning = false;
    };

    const target: ChatStreamTarget = {
      id: senderId,
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
          turnUsage = extractTurnTokenUsage(chunk.data as Record<string, unknown>);
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
      accumulateUsageTotals(totals, turnUsage);
      const sec = ((Date.now() - startedAt) / 1000).toFixed(1);
      output.write(cliTheme.dim(`  ${formatTurnUsageBadge(turnUsage, sec)}`) + '\n');
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

  const stopPipedSwarmSub = state.swarmManager?.onBoardEntry(entry => {
    const active = state.swarmManager?.getSwarmForThread(state.threadId);
    if (!active || active.id !== entry.swarmId) return;
    if (entry.sender === 'user') return;
    output.write(`\n${cliTheme.dim(formatSwarmBoardEntryLine(entry))}\n`);
  });

  const drainActiveSwarmOnEof = async () => {
    const active = state.swarmManager?.getSwarmForThread(state.threadId);
    if (!active || !state.swarmManager) return;
    const view = state.swarmManager.status({ callerThreadId: state.threadId });
    const hasBusy = view.members.some(
      m => m.status === 'working' || m.pendingEvents > 0
    );
    if (!hasBusy) return;
    output.write(
      cliTheme.dim(`\n[swarm] waiting for active members of ${active.id} to finish...\n`)
    );
    try {
      await state.swarmManager.waitForIdle(active.id, 120_000);
    } catch {
      output.write(
        cliTheme.dim(`\n[swarm] timed out waiting for ${active.id}; exiting piped session.\n`)
      );
    }
  };

  output.write(`\n${(await formatBannerLines(state)).join('\n')}\n\n`);
  if (state.initialPrompt) {
    await runTurn(state.initialPrompt);
  }

  let explicitExit = false;
  while (!eof || pendingLines.length > 0) {
    while (pendingLines.length === 0) {
      if (eof) {
        await drainActiveSwarmOnEof();
        stopPipedSwarmSub?.();
        return rl.close();
      }
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
    if (outcome.kind === 'exit') {
      explicitExit = true;
      break;
    }
    if (outcome.kind === 'run-swarm') {
      output.write(
        `\n${outcome.created ? 'Started' : 'Continuing'} swarm ${outcome.swarmId} as @coordinator.\n\n`
      );
      await runTurn(outcome.prompt);
      continue;
    }
    if ('lines' in outcome) {
      output.write(`\n${outcome.lines.join('\n')}\n\n`);
    }
  }
  if (!explicitExit) {
    await drainActiveSwarmOnEof();
  }
  stopPipedSwarmSub?.();
  rl.close();
};
