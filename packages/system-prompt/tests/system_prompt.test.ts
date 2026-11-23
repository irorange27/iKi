import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildToolSystemPrompt,
  diffPromptSections,
  formatPromptContextSnapshot,
  getPersonaPrompt,
  renderPromptSections,
} from '../src/index';

const tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-prompt-test-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('system-prompt', () => {
  it('loads PERSONA.md from home dir, strips HTML comments, and uses day-granular date', () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, 'PERSONA.md'),
      '<!-- comment should be stripped -->\nYou are a focused assistant.\n',
      'utf8'
    );

    const prompt = getPersonaPrompt({ homeDir: dir, now: new Date(2026, 10, 23, 16, 55, 0) });
    expect(prompt).toContain('You are a focused assistant.');
    expect(prompt).not.toContain('comment should be stripped');
    expect(prompt).toContain('Current date: 2026-11-23');
  });

  it('builds dynamic tool rules only for enabled tools without stale approval or ReAct instructions', () => {
    const fileOnly = buildToolSystemPrompt({
      enableTools: true,
      enabledToolNames: ['read_file', 'edit'],
      platform: 'darwin',
    });
    expect(fileOnly).toContain('Read files before editing');
    expect(fileOnly).not.toContain('osascript');
    expect(fileOnly).not.toContain('approval');
    expect(fileOnly).not.toContain('ReAct');
    expect(fileOnly).not.toContain('description');

    const withShell = buildToolSystemPrompt({
      enableTools: true,
      enabledToolNames: ['shell'],
      platform: 'darwin',
    });
    expect(withShell).toContain('osascript');
  });

  it('diffs prompt sections cleanly and formats PromptContext reminders', () => {
    const prev = renderPromptSections([
      { name: 'persona', order: 100, text: 'You are iKi.', tagged: false },
      { name: 'rules', order: 200, text: '- Rule A' },
    ]);
    const next = renderPromptSections([
      { name: 'persona', order: 100, text: 'You are iKi.', tagged: false },
      { name: 'rules', order: 200, text: '- Rule B' },
      { name: 'skills', order: 300, text: 'Skill 1' },
    ]);

    const diff = diffPromptSections(prev, next);
    expect(diff).toEqual({
      rules: '<rules>\n- Rule B\n</rules>',
      skills: '<skills>\nSkill 1\n</skills>',
    });

    const reminder = formatPromptContextSnapshot([
      { name: 'workspace_change', order: 10, text: 'Workspace switched to /repo' },
    ]);
    expect(reminder).toBe('<system_reminder name="workspace_change">\nWorkspace switched to /repo\n</system_reminder>');
  });
});
