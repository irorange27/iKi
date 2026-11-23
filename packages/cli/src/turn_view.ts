import { Box, Container, Markdown, Spacer, Text } from '@earendil-works/pi-tui';
import { cliMarkdownTheme, cliTheme } from './theme';
import {
  formatToolCallCompleted,
  formatToolCallError,
  formatToolCallPending,
} from './tool_render';

type ThinkingBlock = {
  container: Container;
  text: string;
  streaming: boolean;
  startedAt: number;
  finishedAt?: number;
  markdown?: Markdown;
  summaryText?: Text;
};

type TextBlock = {
  markdown: Markdown;
  text: string;
};

type ToolBlock = {
  callId: string;
  toolName: string;
  input: unknown;
  startedAt: number;
  box: Box;
  text: Text;
};

const formatThinkingSummary = (block: ThinkingBlock): string => {
  if (block.streaming) {
    return cliTheme.italic(cliTheme.thinking('Thinking... (Ctrl+T to expand)'));
  }
  const trimmed = block.text.trim();
  const lines = trimmed ? trimmed.split(/\r?\n/).length : 0;
  const elapsedSec =
    typeof block.finishedAt === 'number'
      ? ((Math.max(0, block.finishedAt - block.startedAt)) / 1000).toFixed(1)
      : '';
  const metaParts: string[] = [];
  if (elapsedSec) metaParts.push(`${elapsedSec}s`);
  if (lines > 0) metaParts.push(`${lines} line${lines === 1 ? '' : 's'}`);
  const meta = metaParts.length ? ` (${metaParts.join(' · ')}, Ctrl+T to expand)` : ' (Ctrl+T to expand)';
  return cliTheme.italic(cliTheme.thinking(`Thinking${meta}`));
};

/**
 * Renders one assistant turn in strict chronological order:
 *   thinking -> text -> tool card -> thinking -> text ...
 *
 * Each tool call closes any active text/thinking segment so post-tool model
 * output always appears BELOW the tool card instead of updating an earlier
 * Markdown block above it. Thinking blocks follow pi's UX: either collapsed to
 * a calm "Thinking..." line or rendered in full wrapped italic Markdown,
 * toggleable live via Ctrl+T.
 */
export class TurnView extends Container {
  private hideThinking: boolean;
  private hasVisibleBlocks = false;
  private activeThinking: ThinkingBlock | null = null;
  private activeText: TextBlock | null = null;
  private readonly thinkingBlocks: ThinkingBlock[] = [];
  private readonly toolCards = new Map<string, ToolBlock>();
  private hasAnyText = false;

  constructor(options?: { hideThinking?: boolean }) {
    super();
    this.hideThinking = options?.hideThinking ?? true;
  }

  private appendBlock(component: Container | Markdown | Text | Box): void {
    if (this.hasVisibleBlocks) {
      this.addChild(new Spacer(1));
    }
    this.addChild(component);
    this.hasVisibleBlocks = true;
  }

  private renderThinkingBlock(block: ThinkingBlock): void {
    block.container.clear();
    if (this.hideThinking) {
      block.markdown = undefined;
      block.summaryText = new Text(formatThinkingSummary(block), 1, 0);
      block.container.addChild(block.summaryText);
      return;
    }

    block.summaryText = undefined;
    const content = block.text.trim() || 'Thinking...';
    if (!block.markdown) {
      block.markdown = new Markdown(content, 1, 0, cliMarkdownTheme, {
        color: cliTheme.thinking,
        italic: true,
      });
    } else {
      block.markdown.setText(content);
    }
    block.container.addChild(block.markdown);
  }

  private closeActiveThinking(): void {
    if (!this.activeThinking) return;
    this.activeThinking.streaming = false;
    this.activeThinking.finishedAt = Date.now();
    this.renderThinkingBlock(this.activeThinking);
    this.activeThinking = null;
  }

  private closeActiveText(): void {
    this.activeText = null;
  }

  appendReasoningDelta(delta: string): void {
    if (!delta) return;
    this.closeActiveText();
    if (!this.activeThinking) {
      const container = new Container();
      const block: ThinkingBlock = {
        container,
        text: '',
        streaming: true,
        startedAt: Date.now(),
      };
      this.thinkingBlocks.push(block);
      this.activeThinking = block;
      this.appendBlock(container);
    }
    this.activeThinking.text += delta;
    this.renderThinkingBlock(this.activeThinking);
  }

  appendTextDelta(delta: string): void {
    if (!delta) return;
    this.closeActiveThinking();
    this.hasAnyText = true;
    if (!this.activeText) {
      const markdown = new Markdown('', 1, 0, cliMarkdownTheme, { color: cliTheme.text });
      this.activeText = { markdown, text: '' };
      this.appendBlock(markdown);
    }
    this.activeText.text += delta;
    this.activeText.markdown.setText(this.activeText.text);
  }

  addToolPending(callId: string, toolName: string, input: unknown): void {
    this.closeActiveThinking();
    this.closeActiveText();
    const text = new Text(formatToolCallPending(toolName, input), 0, 0);
    const box = new Box(1, 0, cliTheme.toolPendingBg);
    box.addChild(text);
    this.toolCards.set(callId, {
      callId,
      toolName,
      input,
      startedAt: Date.now(),
      box,
      text,
    });
    this.appendBlock(box);
  }

  completeTool(callId: string, output: unknown): void {
    const card = this.toolCards.get(callId);
    if (!card) return;
    const rendered = formatToolCallCompleted({
      toolName: card.toolName,
      input: card.input,
      output,
      elapsedMs: Date.now() - card.startedAt,
    });
    card.box.setBgFn(
      rendered.tone === 'error'
        ? cliTheme.toolErrorBg
        : rendered.tone === 'background'
          ? cliTheme.toolPendingBg
          : cliTheme.toolSuccessBg
    );
    card.text.setText(rendered.text);
  }

  failTool(callId: string, errorText: string): void {
    const card = this.toolCards.get(callId);
    if (!card) return;
    card.box.setBgFn(cliTheme.toolErrorBg);
    card.text.setText(
      formatToolCallError({
        toolName: card.toolName,
        input: card.input,
        errorText,
      })
    );
  }

  finishTurn(fallbackText?: string): void {
    this.closeActiveThinking();
    this.closeActiveText();
    if (!this.hasAnyText && fallbackText && fallbackText.trim()) {
      this.appendTextDelta(fallbackText);
      this.closeActiveText();
    }
  }

  setHideThinking(hide: boolean): void {
    if (this.hideThinking === hide) return;
    this.hideThinking = hide;
    for (const block of this.thinkingBlocks) {
      this.renderThinkingBlock(block);
    }
  }

  /** Hydrate a persisted assistant message's parts in chronological order for /resume. */
  hydratePersistedParts(parts: readonly unknown[]): void {
    for (const raw of parts) {
      if (!raw || typeof raw !== 'object') continue;
      const part = raw as Record<string, unknown>;
      if (part.type === 'reasoning' && typeof part.text === 'string' && part.text.trim()) {
        this.appendReasoningDelta(part.text);
        this.closeActiveThinking();
      } else if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        this.appendTextDelta(part.text);
      } else if (part.type === 'dynamic-tool' && typeof part.toolName === 'string') {
        const callId =
          typeof part.toolCallId === 'string' ? part.toolCallId : `hist-${this.toolCards.size}`;
        this.addToolPending(callId, part.toolName, part.input);
        if (part.state === 'output-available') {
          this.completeTool(callId, part.output);
        } else if (part.state === 'output-error' || part.state === 'output-denied') {
          this.failTool(
            callId,
            typeof part.errorText === 'string' ? part.errorText : String(part.state)
          );
        }
      }
    }
    this.closeActiveThinking();
    this.closeActiveText();
  }
}
