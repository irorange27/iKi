import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setPlatformInfo } from '@iki/core/platform';
import { wirePlatformContext } from '@iki/core/platform_wiring';
import { initializeDatabase } from '@iki/store/database';
import * as chatThreadDb from '@iki/store/chat_thread';
import {
  getSkillRootsForUi,
  listSkills,
  readSkillInstructions,
} from '../src/tools/skills';
import { resolveSkillsSystemPrompt } from '../src/thread_session/skills';
import { createChatContextAssembler } from '../src/turn_prep/context';

const tempDirs: string[] = [];
const originalAgentsHome = process.env.AGENTS_HOME;

const writeSkill = (root: string, relDir: string, name: string, description: string, body: string) => {
  const dir = path.join(root, relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`,
    'utf8'
  );
};

afterEach(() => {
  if (originalAgentsHome === undefined) {
    delete process.env.AGENTS_HOME;
  } else {
    process.env.AGENTS_HOME = originalAgentsHome;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('skills discovery across user, workspace .agents/skills, and AGENTS_HOME', () => {
  it('discovers workspace .agents/skills with precedence over global ~/.agents/skills and wires into resolveSkillsSystemPrompt', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-skills-data-'));
    const agentsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-agents-home-'));
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-skills-ws-'));
    tempDirs.push(dataDir, agentsHome, workspaceDir);

    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();
    process.env.AGENTS_HOME = agentsHome;

    writeSkill(path.join(dataDir, 'skills'), 'personal-one', 'Personal One', 'User skill', 'Personal body');
    writeSkill(path.join(agentsHome, 'skills'), 'global-only', 'Global Only', 'Global agent skill', 'Global body');
    writeSkill(path.join(agentsHome, 'skills'), 'shared-name', 'Shared Global', 'Global version', 'Global shared body');
    writeSkill(path.join(workspaceDir, '.agents', 'skills'), 'shared-name', 'Shared Workspace', 'Workspace version', 'Workspace shared body');
    writeSkill(path.join(workspaceDir, '.agents', 'skills'), 'repo-only', 'Repo Only', 'Repo skill', 'Repo body');

    const roots = getSkillRootsForUi(workspaceDir);
    expect(roots.map(r => r.path)).toEqual([
      path.join(dataDir, 'skills'),
      path.resolve(workspaceDir, '.agents', 'skills'),
      path.resolve(agentsHome, 'skills'),
    ]);

    const skills = await listSkills({ forceRefresh: true, workspacePath: workspaceDir });
    const byId = new Map(skills.map(s => [s.id, s]));

    expect(byId.get('user:personal-one')?.source).toBe('user');
    expect(byId.get('agent:global-only')?.source).toBe('agent');
    expect(byId.get('agent:repo-only')?.source).toBe('agent');
    expect(byId.get('agent:repo-only')?.path).toBe(
      path.resolve(workspaceDir, '.agents', 'skills', 'repo-only')
    );

    // Workspace .agents/skills must override global ~/.agents/skills on identical relative id
    expect(byId.get('agent:shared-name')?.description).toBe('Workspace version');
    const instructions = await readSkillInstructions('agent:shared-name', {
      workspacePath: workspaceDir,
    });
    expect(instructions?.content).toContain('Workspace shared body');

    // resolveSkillsSystemPrompt resolves workspace-scoped skills cleanly
    const resolved = await resolveSkillsSystemPrompt({
      inputMessages: [{ role: 'user', content: 'use repo-only skill' }],
      workspacePath: workspaceDir,
      skillMode: 'manual',
      skillIds: ['agent:repo-only'],
    });
    expect(resolved.usedSkills.map(s => s.id)).toEqual(['agent:repo-only']);
    expect(resolved.skillsSystemPrompt).toContain('agent:repo-only');
    expect(resolved.skillsSystemPrompt).toContain(path.join('.agents', 'skills', 'repo-only', 'SKILL.md'));
  });

  it('freezes Turn 1 <skills> in systemPrompt and appends subsequent skill edits/additions as anchored tail <system_reminder name="skills">', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-skills-cache-data-'));
    const agentsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-skills-cache-home-'));
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-skills-cache-ws-'));
    tempDirs.push(dataDir, agentsHome, workspaceDir);

    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();
    process.env.AGENTS_HOME = agentsHome;

    writeSkill(
      path.join(workspaceDir, '.agents', 'skills'),
      'alpha',
      'Alpha',
      'Initial alpha description',
      'Alpha v1 instructions'
    );

    chatThreadDb.addChatThread({
      id: 'thread-skills-cache',
      title: 'Skills Cache Test',
      model: 'gpt-test',
    });

    const assembler = createChatContextAssembler({ resolveSkillsSystemPrompt });
    const workspaceSelection = {
      threadId: 'thread-skills-cache',
      workspaceId: 'ws-skills',
      workspace: {
        id: 'ws-skills',
        name: 'ws',
        path: workspaceDir,
        is_temporary: false,
        show_in_list: true,
        created_at: '2026-11-25T00:00:00.000Z',
        updated_at: '2026-11-25T00:00:00.000Z',
      },
    };

    // Turn 1: baseline <skills> admitted into leading systemPrompt; no tail skills reminder
    const t1 = await assembler.assemble({
      threadId: 'thread-skills-cache',
      workspaceSelection,
      skillMode: 'manual',
      skillIds: ['agent:alpha'],
      userMessageIds: ['u1'],
      messages: [{ role: 'user', content: 'turn 1' }],
    });
    const sys1 = String(t1.messages[0]!.content);
    expect(sys1).toContain('<skills>');
    expect(sys1).toContain('Initial alpha description');
    expect(t1.messages.some(m => String(m.content).includes('<system_reminder name="skills">'))).toBe(false);

    // Turn 2: no skill changes -> byte-identical prefix, no skills reminder
    const t2 = await assembler.assemble({
      threadId: 'thread-skills-cache',
      workspaceSelection,
      skillMode: 'manual',
      skillIds: ['agent:alpha'],
      userMessageIds: ['u1', 'u2'],
      messages: [
        { role: 'user', content: 'turn 1' },
        { role: 'assistant', content: 'reply 1' },
        { role: 'user', content: 'turn 2' },
      ],
    });
    expect(String(t2.messages[0]!.content)).toBe(sys1);
    expect(t2.messages.some(m => String(m.content).includes('<system_reminder name="skills">'))).toBe(false);

    // Modify alpha's SKILL.md AND add a new skill beta before Turn 3
    writeSkill(
      path.join(workspaceDir, '.agents', 'skills'),
      'alpha',
      'Alpha',
      'Updated alpha description',
      'Alpha v2 instructions'
    );
    writeSkill(
      path.join(workspaceDir, '.agents', 'skills'),
      'beta',
      'Beta',
      'Brand new beta skill',
      'Beta instructions'
    );

    // Turn 3: systemPrompt stays frozen to Turn 1; tail <system_reminder name="skills"> inserted right before u3!
    const t3 = await assembler.assemble({
      threadId: 'thread-skills-cache',
      workspaceSelection,
      skillMode: 'manual',
      skillIds: ['agent:alpha', 'agent:beta'],
      userMessageIds: ['u1', 'u2', 'u3'],
      messages: [
        { role: 'user', content: 'turn 1' },
        { role: 'assistant', content: 'reply 1' },
        { role: 'user', content: 'turn 2' },
        { role: 'assistant', content: 'reply 2' },
        { role: 'user', content: 'turn 3' },
      ],
    });
    // Leading systemPrompt MUST stay byte-identical to Turn 1 (never mutated!)
    expect(String(t3.messages[0]!.content)).toBe(sys1);
    // Prefix up through reply 2 stays byte-identical to Turn 2
    expect(t3.messages.slice(0, t2.messages.length - 1)).toEqual(t2.messages.slice(0, -1));
    // Reminder sits immediately before u3 (at the tail!)
    const reminderMsg = t3.messages[t3.messages.length - 2]!;
    const lastMsg = t3.messages[t3.messages.length - 1]!;
    expect(reminderMsg.role).toBe('user');
    expect(String(reminderMsg.content)).toContain('<system_reminder name="skills">');
    expect(String(reminderMsg.content)).toContain('Updated alpha description');
    expect(String(reminderMsg.content)).toContain('agent:beta');
    expect(String(lastMsg.content)).toBe('turn 3');

    // Turn 4: no further edits -> Turn 3's reminder replays in-place before u3 so Turn 1..3 prefix stays 100% cache-identical!
    const t4 = await assembler.assemble({
      threadId: 'thread-skills-cache',
      workspaceSelection,
      skillMode: 'manual',
      skillIds: ['agent:alpha', 'agent:beta'],
      userMessageIds: ['u1', 'u2', 'u3', 'u4'],
      messages: [
        { role: 'user', content: 'turn 1' },
        { role: 'assistant', content: 'reply 1' },
        { role: 'user', content: 'turn 2' },
        { role: 'assistant', content: 'reply 2' },
        { role: 'user', content: 'turn 3' },
        { role: 'assistant', content: 'reply 3' },
        { role: 'user', content: 'turn 4' },
      ],
    });
    expect(t4.messages.slice(0, t3.messages.length)).toEqual(t3.messages);
    expect(
      t4.messages.filter(m => String(m.content).includes('<system_reminder name="skills">'))
    ).toHaveLength(1);
    expect(String(t4.messages.at(-1)!.content)).toBe('turn 4');
  });
});
