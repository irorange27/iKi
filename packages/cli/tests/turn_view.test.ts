import { describe, expect, it } from 'vitest';
import { TurnView } from '../src/turn_view';

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const stripAnsi = (value: string): string => value.replace(ANSI_RE, '');

describe('TurnView chronological ordering & thinking collapse/expand', () => {
  it('renders pre-tool text, bash card, and post-tool final answer in strict chronological order', () => {
    const view = new TurnView({ hideThinking: true });

    view.appendReasoningDelta('Need to check version first.');
    view.appendTextDelta('Let me check git status:');
    view.addToolPending('tc-1', 'bash', { command: 'git status -s' });
    view.completeTool('tc-1', {
      type: 'json',
      value: { stdout: 'M README.md', exitCode: 0, durationMs: 45 },
    });
    view.appendReasoningDelta('Looks clean except README.md.');
    view.appendTextDelta('Only README.md is modified.');
    view.finishTurn();

    const rendered = stripAnsi(view.render(100).join('\n'));
    const preToolIdx = rendered.indexOf('Let me check git status:');
    const bashCardIdx = rendered.indexOf('$ git status -s');
    const postToolIdx = rendered.indexOf('Only README.md is modified.');

    expect(preToolIdx).toBeGreaterThan(-1);
    expect(bashCardIdx).toBeGreaterThan(preToolIdx);
    expect(postToolIdx).toBeGreaterThan(bashCardIdx);
    expect(rendered).toContain('M README.md');
    expect(rendered).toContain('Thinking (');
    expect(rendered).not.toContain('Need to check version first.');
  });

  it('toggles full readable thinking content on setHideThinking(false) without single-line truncation', () => {
    const view = new TurnView({ hideThinking: true });
    const longThought =
      'Step 1: inspect the build pipeline.\nStep 2: verify every module boundary and cache key.\nStep 3: conclude with a concise answer.';
    view.appendReasoningDelta(longThought);
    view.appendTextDelta('Done.');
    view.finishTurn();

    const collapsed = stripAnsi(view.render(100).join('\n'));
    expect(collapsed).toContain('Thinking (');
    expect(collapsed).not.toContain('Step 1: inspect');

    view.setHideThinking(false);
    const expanded = stripAnsi(view.render(100).join('\n'));
    expect(expanded).toContain('Step 1: inspect the build pipeline.');
    expect(expanded).toContain('Step 2: verify every module boundary and cache key.');
    expect(expanded).toContain('Step 3: conclude with a concise answer.');
  });

  it('hydrates resumed multi-step assistant parts in chronological order', () => {
    const view = new TurnView({ hideThinking: true });
    view.hydratePersistedParts([
      { type: 'reasoning', text: 'check files' },
      { type: 'text', text: 'Checking files...' },
      {
        type: 'dynamic-tool',
        toolCallId: 'tc-h1',
        toolName: 'bash',
        state: 'output-available',
        input: { command: 'ls' },
        output: { type: 'json', value: { stdout: 'package.json', exitCode: 0 } },
      },
      { type: 'text', text: 'Found package.json.' },
    ]);

    const rendered = stripAnsi(view.render(100).join('\n'));
    expect(rendered.indexOf('Checking files...')).toBeLessThan(rendered.indexOf('$ ls'));
    expect(rendered.indexOf('$ ls')).toBeLessThan(rendered.indexOf('Found package.json.'));
  });
});
