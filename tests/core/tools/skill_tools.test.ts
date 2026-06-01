import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DeletePersonalSkillTool,
  ListPersonalSkillsTool,
  LoadSkillTool,
  ReadPersonalSkillTool,
  WritePersonalSkillTool,
} from '../../../src/core/tools/skill_tools';
import { runWithToolRuntimeContext } from '../../../src/core/tools/runtime_context';

describe('load skill tool', () => {
  let tempRoot = '';
  let previousCodexHome: string | undefined;
  let previousUserDataPath: string | undefined;

  const userDataPath = () => path.join(tempRoot, 'user-data');

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-load-skill-tool-'));
    previousCodexHome = process.env.CODEX_HOME;
    previousUserDataPath = process.env.IKI_USER_DATA_PATH;
    process.env.CODEX_HOME = path.join(tempRoot, 'codex-home');
    process.env.IKI_USER_DATA_PATH = userDataPath();

    const skillDir = path.join(userDataPath(), 'skills', 'planner');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: planner
description: Planning support
required_tools: ["shell"]
---

# Planner

Step 1: Inspect.
Step 2: Plan.
`,
      'utf-8'
    );
  });

  afterEach(async () => {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }

    if (previousUserDataPath === undefined) {
      delete process.env.IKI_USER_DATA_PATH;
    } else {
      process.env.IKI_USER_DATA_PATH = previousUserDataPath;
    }

    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('loads instruction content for a skill enabled in the runtime context', async () => {
    const tool = new LoadSkillTool();

    const result = await runWithToolRuntimeContext(
      { availableSkillIds: ['user:planner'] },
      async () => await tool.execute({ id: 'user:planner' })
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'user:planner',
        name: 'Planner',
        source: 'user',
        truncated: false,
      })
    );
    expect((result as { content: string }).content).toContain('<skill id="user:planner"');
    expect((result as { content: string }).content).toContain('# Planner');
    expect((result as { content: string }).content).not.toContain('description: Planning support');
  });

  it('rejects requests for skills that do not exist on disk', async () => {
    const tool = new LoadSkillTool();

    await expect(
      runWithToolRuntimeContext({ availableSkillIds: ['user:planner'] }, async () =>
        tool.execute({ id: 'user:nonexistent' })
      )
    ).rejects.toThrow(/not found/i);
  });

  it('publishes concrete input and output JSON schemas for the AI tool boundary', () => {
    const tool = new LoadSkillTool();
    const agentTool = tool.toAgentTool();

    expect(agentTool.parameters).toEqual(
      expect.objectContaining({
        type: 'object',
        title: 'load_skill',
        properties: expect.objectContaining({
          id: expect.objectContaining({
            type: 'string',
          }),
        }),
        required: expect.arrayContaining(['id']),
      })
    );

    expect(tool.outputSchema).toEqual(
      expect.objectContaining({
        type: 'object',
        title: 'load_skill_output',
        properties: expect.objectContaining({
          id: expect.objectContaining({ type: 'string' }),
          name: expect.objectContaining({ type: 'string' }),
          source: expect.objectContaining({ type: 'string' }),
          content: expect.objectContaining({ type: 'string' }),
          truncated: expect.objectContaining({ type: 'boolean' }),
        }),
      })
    );
  });

  it('lists and reads personal skills without requiring workspace hacks', async () => {
    const listTool = new ListPersonalSkillsTool();
    const readTool = new ReadPersonalSkillTool();

    const listed = (await listTool.execute({ query: 'planner' })) as {
      rootPath: string;
      resultCount: number;
      skills: Array<{ id: string; name: string; requiredTools?: string[] }>;
    };

    expect(listed.rootPath).toBe(path.join(userDataPath(), 'skills'));
    expect(listed.resultCount).toBe(1);
    expect(listed.skills[0]).toEqual(
      expect.objectContaining({
        id: 'user:planner',
        name: 'Planner',
        requiredTools: ['shell'],
      })
    );

    const read = (await readTool.execute({ id: 'user:planner' })) as {
      id: string;
      name: string;
      description: string;
      requiredTools?: string[];
      content: string;
    };

    expect(read).toEqual(
      expect.objectContaining({
        id: 'user:planner',
        name: 'Planner',
        description: 'Planning support',
        requiredTools: ['shell'],
      })
    );
    expect(read.content).toContain('# Planner');
  });

  it('writes a personal skill and marks the tool as always requiring approval', async () => {
    const tool = new WritePersonalSkillTool();
    const result = (await tool.execute({
      id: 'user:writer',
      skillName: 'Writer',
      skillDescription: 'Writing support',
      instructions: 'Draft, revise, and tighten prose.',
    })) as {
      action: string;
      id: string;
      name: string;
      description: string;
      content: string;
      filePath: string;
    };

    expect(tool.needsApproval).toBe(true);
    expect(tool.approvalMode).toBe('always');
    expect(result).toEqual(
      expect.objectContaining({
        action: 'created',
        id: 'user:writer',
        name: 'Writer',
        description: 'Writing support',
      })
    );
    expect(result.content).toContain('name: "Writer"');
    expect(result.content).toContain('# Writer');
    expect(await fs.readFile(result.filePath, 'utf-8')).toContain(
      'Draft, revise, and tighten prose.'
    );
  });

  it('updates an existing personal skill while preserving metadata when omitted', async () => {
    const tool = new WritePersonalSkillTool();

    const result = (await tool.execute({
      id: 'user:planner',
      instructions: 'Step 1: Inspect.\nStep 2: Plan.\nStep 3: Verify.',
    })) as {
      action: string;
      name: string;
      description: string;
      content: string;
    };

    expect(result.action).toBe('updated');
    expect(result.name).toBe('Planner');
    expect(result.description).toBe('Planning support');
    expect(result.content).toContain('description: "Planning support"');
    expect(result.content).toContain('required_tools: ["shell"]');
    expect(result.content).toContain('Step 3: Verify.');
  });

  it('deletes a personal skill and reports whether anything was removed', async () => {
    const tool = new DeletePersonalSkillTool();

    expect(tool.needsApproval).toBe(true);
    expect(tool.approvalMode).toBe('always');

    await expect(
      fs.access(path.join(userDataPath(), 'skills', 'planner', 'SKILL.md'))
    ).resolves.toBeUndefined();

    await expect(tool.execute({ id: 'user:planner' })).resolves.toEqual({
      deleted: true,
      id: 'user:planner',
      filePath: path.join(userDataPath(), 'skills', 'planner', 'SKILL.md'),
    });

    await expect(
      fs.access(path.join(userDataPath(), 'skills', 'planner', 'SKILL.md'))
    ).rejects.toBeTruthy();

    await expect(tool.execute({ id: 'user:planner' })).resolves.toEqual({
      deleted: false,
      id: 'user:planner',
      filePath: path.join(userDataPath(), 'skills', 'planner', 'SKILL.md'),
    });
  });
});
