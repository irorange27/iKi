import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CombinedAutocompleteProvider } from '@earendil-works/pi-tui';
import { inspectAgentInstructionsForWorkspace } from '@iki/harness/turn_prep/context_blocks';
import { buildSlashCommands, type InteractiveCliState } from '../src/commands';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('CLI slash command autocomplete', () => {
  it('completes built-in commands on `/` and tool names on `/tools `', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-cli-ac-'));
    tempDirs.push(workDir);

    const fakeState: InteractiveCliState = {
      chatService: {
        listThreads: () => [
          {
            id: 'cli_demo_1',
            title: 'Demo Thread',
            provider_type: 'openai-compatible',
            model: 'test-model',
          },
        ],
      } as unknown as InteractiveCliState['chatService'],
      dataDir: workDir,
      threadId: 'cli_demo_1',
      providerType: 'openai-compatible',
      model: 'test-model',
      workspace: workDir,
      skillMode: 'auto',
    };

    const provider = new CombinedAutocompleteProvider(buildSlashCommands(fakeState), workDir);
    const controller = new AbortController();

    const slashSuggestions = await provider.getSuggestions(['/'], 0, 1, {
      signal: controller.signal,
    });
    expect(slashSuggestions).not.toBeNull();
    const names = slashSuggestions?.items.map(item => item.value) ?? [];
    expect(names).toEqual(
      expect.arrayContaining(['help', 'models', 'model', 'resume', 'threads', 'thread', 'new', 'history', 'compact', 'context', 'system', 'tools', 'skills', 'usage', 'clear', 'exit'])
    );

    const modFilter = await provider.getSuggestions(['/mo'], 0, 3, {
      signal: controller.signal,
    });
    expect(modFilter?.items.map(i => i.value)).toEqual(['models', 'model']);

    fs.writeFileSync(path.join(workDir, 'AGENT.md'), '# Repo Rules\nUse strict types.\n');
    const inspected = inspectAgentInstructionsForWorkspace(workDir);
    expect(inspected?.filename).toBe('AGENT.md');
    expect(inspected?.lineCount).toBe(2);

    const threadArgs = await provider.getSuggestions(['/thread cli'], 0, 11, {
      signal: controller.signal,
    });
    expect(threadArgs?.items.map(i => i.value)).toEqual(['cli_demo_1']);

    const toolArgs = await provider.getSuggestions(['/tools all'], 0, 10, {
      signal: controller.signal,
    });
    expect(toolArgs?.items.map(i => i.value)).toEqual(['all']);
  });
});
