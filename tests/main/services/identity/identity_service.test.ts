import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getActiveIdentityProfileMock,
  addIdentityProfileMock,
} = vi.hoisted(() => ({
  getActiveIdentityProfileMock: vi.fn(),
  addIdentityProfileMock: vi.fn(),
}));

vi.mock('../../../../src/core/db/identity', () => ({
  getActiveIdentityProfile: getActiveIdentityProfileMock,
  addIdentityProfile: addIdentityProfileMock,
}));

import {
  buildIdentitySystemMessage,
  getIdentityContextMessage,
} from '../../../../src/main/services/identity/identity_service';

const tempDirs: string[] = [];

const createTempUserDataPath = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-identity-'));
  tempDirs.push(directory);
  process.env.IKI_USER_DATA_PATH = directory;
  return directory;
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.IKI_USER_DATA_PATH;
});

describe('identity_service', () => {
  it('builds a compact identity system message from the stored profile', () => {
    const message = buildIdentitySystemMessage({
      id: 'identity_default',
      name: 'iKi Core',
      self_description: 'A grounded personal AI brain.',
      owner_name: 'Nina',
      relationship_to_owner: 'trusted companion',
      core_values: '["truthful","privacy-preserving"]',
      boundaries: '["Do not fabricate embodiment."]',
      tone_guidance: 'Calm and thoughtful.',
      active: 1,
      metadata: null,
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
    });

    expect(message).toContain('Identity profile for iKi:');
    expect(message).toContain('- Name: iKi Core');
    expect(message).toContain('- Owner label: Nina');
    expect(message).toContain('truthful');
    expect(message).toContain('Do not fabricate embodiment.');
  });

  it('creates a default active profile when none exists', () => {
    getActiveIdentityProfileMock.mockReturnValueOnce(null).mockReturnValueOnce({
      id: 'identity_default',
      name: 'iKi Core',
      self_description: 'Default identity.',
      owner_name: 'the user',
      relationship_to_owner: 'trusted personal AI companion.',
      core_values: '["truthful"]',
      boundaries: '["Do not fabricate embodiment."]',
      tone_guidance: 'Grounded.',
      active: 1,
      metadata: null,
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
    });
    addIdentityProfileMock.mockReturnValue({
      id: 'identity_default',
      name: 'iKi Core',
      self_description: 'Default identity.',
      owner_name: 'the user',
      relationship_to_owner: 'trusted personal AI companion.',
      core_values: '["truthful"]',
      boundaries: '["Do not fabricate embodiment."]',
      tone_guidance: 'Grounded.',
      active: 1,
      metadata: null,
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
    });

    const message = getIdentityContextMessage();

    expect(addIdentityProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'iKi Core',
        active: true,
      })
    );
    expect(message).toContain('Identity profile for iKi:');
  });

  it('creates the local brain markdown layout without injecting empty templates', () => {
    const userDataPath = createTempUserDataPath();
    getActiveIdentityProfileMock.mockReturnValue({
      id: 'identity_default',
      name: 'iKi Core',
      self_description: 'Default identity.',
      owner_name: 'the user',
      relationship_to_owner: 'trusted personal AI companion.',
      core_values: '["truthful"]',
      boundaries: '["Do not fabricate embodiment."]',
      tone_guidance: 'Grounded.',
      active: 1,
      metadata: null,
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
    });

    const message = getIdentityContextMessage();

    expect(fs.existsSync(path.join(userDataPath, 'brain', 'iki.md'))).toBe(true);
    expect(fs.existsSync(path.join(userDataPath, 'brain', 'owner.md'))).toBe(true);
    expect(fs.existsSync(path.join(userDataPath, 'brain', 'relationship.md'))).toBe(true);
    expect(fs.existsSync(path.join(userDataPath, 'brain', 'memory_inbox'))).toBe(true);
    expect(fs.existsSync(path.join(userDataPath, 'brain', 'reflections'))).toBe(true);
    expect(message).toContain('Identity profile for iKi:');
    expect(message).not.toContain('User-editable continuity notes from the local brain folder.');
  });

  it('injects meaningful local brain markdown into the identity context', () => {
    const userDataPath = createTempUserDataPath();
    const brainPath = path.join(userDataPath, 'brain');
    fs.mkdirSync(brainPath, { recursive: true });
    fs.writeFileSync(
      path.join(brainPath, 'owner.md'),
      '# Owner\n\n- Preferred name: Nina\n- Reply language: Simplified Chinese\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(brainPath, 'relationship.md'),
      [
        '# Relationship',
        '',
        '<!-- Hidden note -->',
        '',
        '- Default to concise, direct replies.',
        '',
      ].join('\n'),
      'utf8'
    );
    getActiveIdentityProfileMock.mockReturnValue({
      id: 'identity_default',
      name: 'iKi Core',
      self_description: 'Default identity.',
      owner_name: 'the user',
      relationship_to_owner: 'trusted personal AI companion.',
      core_values: '["truthful"]',
      boundaries: '["Do not fabricate embodiment."]',
      tone_guidance: 'Grounded.',
      active: 1,
      metadata: null,
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
    });

    const message = getIdentityContextMessage();

    expect(message).toContain('User-editable continuity notes from the local brain folder.');
    expect(message).toContain('## Owner');
    expect(message).toContain('Preferred name: Nina');
    expect(message).toContain('Reply language: Simplified Chinese');
    expect(message).toContain('## Relationship');
    expect(message).toContain('Default to concise, direct replies.');
    expect(message).not.toContain('Hidden note');
  });
});

afterEach(() => {
  delete process.env.IKI_USER_DATA_PATH;
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (!directory) continue;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
