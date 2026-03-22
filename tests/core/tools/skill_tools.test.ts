import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LoadSkillTool } from '../../../src/core/tools/skill_tools';
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

  it('rejects requests for skills that were not selected for the current turn', async () => {
    const tool = new LoadSkillTool();

    await expect(
      runWithToolRuntimeContext({ availableSkillIds: ['user:planner'] }, async () =>
        tool.execute({ id: 'user:writer' })
      )
    ).rejects.toThrow(/not enabled for this turn/i);
  });
});
