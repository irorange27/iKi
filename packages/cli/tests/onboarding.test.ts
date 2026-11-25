import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { setPlatformInfo } from '@iki/core/platform';
import { wirePlatformContext } from '@iki/core/platform_wiring';
import { initializeDatabase } from '@iki/store/database';
import { addProvider, getProviders } from '@iki/store/providers';
import { getMcpManager } from '@iki/harness/mcp';
import { formatMcpBannerSummary } from '../src/mcp_commands';
import {
  bootstrapProvidersFromEnv,
  formatMissingProviderGuide,
  runCliOnboardingWizard,
} from '../src/onboarding';

const tempDirs: string[] = [];

const makeTempDir = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('CLI zero-friction onboarding', () => {
  it('detects standard provider API keys and custom gateway env vars into models.toml', () => {
    const dataDir = makeTempDir('iki-onboard-detect-');
    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();

    const detected = bootstrapProvidersFromEnv({
      DEEPSEEK_API_KEY: 'sk-ds-test',
      DEEPSEEK_MODEL: 'deepseek-reasoner',
      OPENROUTER_API_KEY: 'sk-or-test',
      IKI_BASE_URL: 'http://127.0.0.1:3425/v1',
      IKI_API_KEY: 'sk-local',
      IKI_MODEL: 'auto/deepseek-v4-flash',
    });

    expect(detected.map(d => d.provider.id)).toEqual(['custom', 'deepseek', 'openrouter']);
    expect(detected[0]!.provider).toMatchObject({
      type: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:3425/v1',
      models: ['auto/deepseek-v4-flash'],
      enabled: true,
    });
    expect(detected[1]!.provider).toMatchObject({
      type: 'deepseek',
      models: ['deepseek-reasoner'],
    });
  });

  it('bootstraps models.toml from env idempotently without overwriting user providers', () => {
    const dataDir = makeTempDir('iki-onboard-env-');
    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();

    addProvider({
      id: 'deepseek',
      name: 'My Custom DeepSeek',
      type: 'deepseek',
      apiKey: 'sk-existing',
      baseUrl: 'https://custom.deepseek.example/v1',
      enabled: true,
      models: ['deepseek-chat'],
    });

    const created = bootstrapProvidersFromEnv({
      DEEPSEEK_API_KEY: 'sk-should-not-overwrite',
      OPENAI_API_KEY: 'sk-openai-new',
    });

    expect(created.map(c => c.provider.id)).toEqual(['openai']);
    const providers = getProviders();
    expect(providers.find(p => p.id === 'deepseek')?.apiKey).toBe('sk-existing');
    expect(providers.find(p => p.id === 'openai')).toMatchObject({
      type: 'openai',
      apiKey: 'sk-openai-new',
      enabled: true,
    });

    const guide = formatMissingProviderGuide(dataDir);
    expect(guide).toContain('DEEPSEEK_API_KEY');
    expect(guide).toContain('iki setup');
  });

  it('runs interactive setup wizard and saves chosen provider into models.toml', async () => {
    const dataDir = makeTempDir('iki-onboard-wizard-');
    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();

    const input = new PassThrough();
    const output = new PassThrough();
    let rendered = '';
    output.on('data', chunk => {
      rendered += String(chunk);
    });

    // Choice 3 = DeepSeek, default baseUrl, api key, custom model
    input.end('3\n\nsk-wizard-key\ndeepseek-chat\n');

    const saved = await runCliOnboardingWizard({ dataDir, input, output });
    expect(saved).not.toBeNull();
    expect(saved).toMatchObject({
      id: 'deepseek',
      type: 'deepseek',
      apiKey: 'sk-wizard-key',
      baseUrl: 'https://api.deepseek.com/v1',
      enabled: true,
      models: ['deepseek-chat'],
    });
    expect(rendered).toContain('Welcome to iKi');
    expect(getProviders().find(p => p.id === 'deepseek')?.apiKey).toBe('sk-wizard-key');
  });

  it('surfaces discovered workspace .mcp.json in the MCP banner summary', () => {
    const dataDir = makeTempDir('iki-banner-data-');
    const workspaceDir = makeTempDir('iki-banner-ws-');
    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();

    fs.writeFileSync(
      path.join(workspaceDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { demo: { command: 'node', args: ['-v'] } } })
    );

    const summary = formatMcpBannerSummary(getMcpManager(), {
      workspacePath: workspaceDir,
      dataDir,
    });
    expect(summary).toContain('found mcp.json');
    expect(summary).toContain('/mcp import');
  });
});
