import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listSkills } from '../../../src/core/skills';

describe('core skills metadata extraction', () => {
  let tempRoot = '';
  let previousCodexHome: string | undefined;
  let previousUserDataPath: string | undefined;

  const userDataPath = () => path.join(tempRoot, 'user-data');
  const codexHomePath = () => path.join(tempRoot, 'codex-home');

  const writeSkill = async (
    baseDir: string,
    relativeDir: string,
    content: string
  ): Promise<void> => {
    const skillDir = path.join(baseDir, 'skills', relativeDir);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
  };

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-skills-'));
    previousCodexHome = process.env.CODEX_HOME;
    previousUserDataPath = process.env.IKI_USER_DATA_PATH;
    process.env.CODEX_HOME = codexHomePath();
    process.env.IKI_USER_DATA_PATH = userDataPath();
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

  it('prefers frontmatter description over body preview text', async () => {
    await writeSkill(
      codexHomePath(),
      'preview-test',
      `---
name: "preview-test"
description: "Use metadata description for preview."
metadata:
  short-description: "Incorrect shorter preview"
---

# Preview Test

Body text should not become the preview description.
`
    );

    const skills = await listSkills({ forceRefresh: true });

    expect(skills).toContainEqual(
      expect.objectContaining({
        id: 'codex:preview-test',
        name: 'Preview Test',
        description: 'Use metadata description for preview.',
      })
    );
  });

  it('normalizes multiline frontmatter descriptions', async () => {
    await writeSkill(
      userDataPath(),
      'multiline-preview',
      `---
name: multiline-preview
description: >
  First line of the preview.
  Second line of the preview.
---
`
    );

    const skills = await listSkills({ forceRefresh: true });

    expect(skills).toContainEqual(
      expect.objectContaining({
        id: 'user:multiline-preview',
        name: 'multiline-preview',
        description: 'First line of the preview. Second line of the preview.',
      })
    );
  });

  it('falls back to markdown content when frontmatter description is missing', async () => {
    await writeSkill(
      userDataPath(),
      'legacy-preview',
      `---
name: legacy-preview
---

# Legacy Preview

Fallback description from markdown body.

Additional details below.
`
    );

    const skills = await listSkills({ forceRefresh: true });

    expect(skills).toContainEqual(
      expect.objectContaining({
        id: 'user:legacy-preview',
        name: 'Legacy Preview',
        description: 'Fallback description from markdown body.',
      })
    );
  });
});
