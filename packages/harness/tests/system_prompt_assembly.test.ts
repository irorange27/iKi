import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setPlatformInfo } from '@iki/core/platform';
import { projectHistoryToPiContext } from '@iki/llm-pi-ai/pi_adapter';
import { assembleRequestSystemPrompt } from '@iki/system-prompt/assembler';
import { getPersonaPrompt } from '@iki/system-prompt/persona';
import { buildToolSystemPrompt } from '@iki/system-prompt/tool_rules';
import { createChatContextAssembler } from '../src/turn_prep/context';
import { buildSkillsMetadataSystemPrompt } from '../src/tools/skills';

const tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-context-asm-test-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('system prompt assembly & cache-safe projection', () => {
  it('merges static project_context + skills into one leading system message and isolates runtime reminder to user role', async () => {
    const rootDir = makeTempDir();
    const userDataDir = path.join(rootDir, 'user-data');
    const workspaceDir = path.join(rootDir, 'workspace');
    const skillDir = path.join(userDataDir, 'skills', 'demo');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, 'AGENTS.md'), 'Always run pnpm test before ship.\n', 'utf8');
    setPlatformInfo({ userDataPath: userDataDir });

    const assembler = createChatContextAssembler({
      resolveSkillsSystemPrompt: async () => ({
        skillMode: 'manual',
        usedSkills: [
          {
            id: 'user:demo',
            name: 'demo',
            description: 'Demo skill description',
            source: 'user',
            path: skillDir,
          },
        ],
        skillsSystemPrompt: buildSkillsMetadataSystemPrompt([
          {
            id: 'user:demo',
            name: 'demo',
            description: 'Demo skill description',
            source: 'user',
            path: skillDir,
          },
        ]),
      }),
    });

    const assembled = await assembler.assemble({
      messages: [{ role: 'user', content: 'Fix the failing test.' }],
      workspaceSelection: {
        threadId: 'thread-1',
        workspaceId: 'ws-1',
        workspace: {
          id: 'ws-1',
          name: 'demo-repo',
          path: workspaceDir,
          is_temporary: false,
          show_in_list: true,
          created_at: '2026-11-23T00:00:00.000Z',
          updated_at: '2026-11-23T00:00:00.000Z',
        },
      },
      skillIds: ['user:demo'],
      skillMode: 'manual',
    });

    const systemMessages = assembled.messages.filter(m => m.role === 'system');
    expect(systemMessages).toHaveLength(1);
    const systemText = String(systemMessages[0].content);
    expect(systemText).toContain('<project_context>');
    expect(systemText).toContain('Always run pnpm test before ship.');
    expect(systemText).toContain('<skills>');
    expect(systemText).toContain(path.join(skillDir, 'SKILL.md'));
    expect(systemText).not.toContain('load_skill');
    expect(systemText).not.toContain('Current date:');
    expect(systemText).not.toContain('Current workspace:');
    expect(systemText.indexOf('<project_context>')).toBeLessThan(systemText.indexOf('<skills>'));

    const runtimeMsg = assembled.messages[1];
    expect(runtimeMsg.role).toBe('user');
    expect(String(runtimeMsg.content)).toContain('<system_reminder name="runtime">');
    expect(String(runtimeMsg.content)).toContain('Current date:');
    expect(String(runtimeMsg.content)).toContain(`Current workspace: demo-repo (${workspaceDir}).`);

    const projected = projectHistoryToPiContext(
      assembled.messages,
      'claude-sonnet-4-5',
      'anthropic'
    );
    expect(projected.messages.some(m => m.role === 'system')).toBe(false);

    const requestSystem = assembleRequestSystemPrompt([
      { slot: 'persona', text: getPersonaPrompt({ homeDir: userDataDir }) },
      {
        slot: 'planPrompt',
        text: buildToolSystemPrompt({ enableTools: true, enabledToolNames: ['bash', 'job'] }),
      },
      { slot: 'transcriptSystem', text: projected.systemPrompt },
    ]);
    expect(requestSystem).not.toContain('Current date:');
    expect(requestSystem).not.toContain(`Current workspace: demo-repo (${workspaceDir}).`);
    expect(requestSystem).toContain('<project_context>');
    expect(requestSystem).toContain('<skills>');
  });

  it('never clips project AGENTS.md to the legacy 320-token persona budget', async () => {
    const rootDir = makeTempDir();
    const userDataDir = path.join(rootDir, 'user-data');
    const workspaceDir = path.join(rootDir, 'workspace');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    const longAgentsMd = [
      '# Project Rules',
      ...Array.from({ length: 80 }, (_, i) => `- Rule ${i + 1}: keep module boundaries clean and tested.`),
      'FINAL_TAIL_MARKER_THREAD_SESSION',
    ].join('\n');
    fs.writeFileSync(path.join(workspaceDir, 'AGENTS.md'), longAgentsMd, 'utf8');
    setPlatformInfo({ userDataPath: userDataDir });

    const assembler = createChatContextAssembler({
      resolveSkillsSystemPrompt: async () => ({
        skillMode: 'auto',
        usedSkills: [],
        skillsSystemPrompt: '',
      }),
    });

    const assembled = await assembler.assemble({
      messages: [{ role: 'user', content: 'Where is thread_session?' }],
      workspaceSelection: {
        threadId: 'thread-long-agents',
        workspaceId: 'ws-long',
        workspace: {
          id: 'ws-long',
          name: 'long-repo',
          path: workspaceDir,
          is_temporary: false,
          show_in_list: true,
          created_at: '2026-11-23T00:00:00.000Z',
          updated_at: '2026-11-23T00:00:00.000Z',
        },
      },
      contextBudgetOverride: { enabled: true, maxIdentityTokens: 320, maxSkillTokens: 1200 },
    });

    const systemText = String(assembled.messages.find(m => m.role === 'system')?.content ?? '');
    expect(systemText).toContain('FINAL_TAIL_MARKER_THREAD_SESSION');
    expect(assembled.report.blocks.find(b => b.kind === 'identity')?.status).toBe('included');
  });
});
