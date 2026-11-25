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
import { SetupSearchListStep, SetupTextStep } from '../src/setup_tui';

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
  it('detects standard provider API keys across pi-ai providers and custom gateway env vars', () => {
    const dataDir = makeTempDir('iki-onboard-detect-');
    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();

    const detected = bootstrapProvidersFromEnv({
      DEEPSEEK_API_KEY: 'sk-ds-test',
      DEEPSEEK_MODEL: 'deepseek-reasoner',
      GEMINI_API_KEY: 'sk-gm-test',
      GROQ_API_KEY: 'sk-groq-test',
      OPENROUTER_API_KEY: 'sk-or-test',
      IKI_BASE_URL: 'http://127.0.0.1:3425/v1',
      IKI_API_KEY: 'sk-local',
      IKI_MODEL: 'auto/deepseek-v4-flash',
    });

    expect(detected.map(d => d.provider.id)).toEqual([
      'custom',
      'deepseek',
      'google',
      'openrouter',
      'groq',
    ]);
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
    expect(detected[2]!.provider).toMatchObject({
      type: 'google',
      apiKey: 'sk-gm-test',
    });
    expect(detected[4]!.provider).toMatchObject({
      type: 'groq',
      apiKey: 'sk-groq-test',
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
    expect(guide).toContain('ANTHROPIC_API_KEY');
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

    // Type a pi-ai provider ID directly (`mistral`) after listing all built-in providers
    input.end('all\nmistral\n\nsk-wizard-key\n\n');

    const saved = await runCliOnboardingWizard({ dataDir, input, output });
    expect(saved).not.toBeNull();
    expect(saved).toMatchObject({
      id: 'mistral',
      type: 'mistral',
      apiKey: 'sk-wizard-key',
      baseUrl: 'https://api.mistral.ai',
      enabled: true,
    });
    expect(saved!.models.length).toBe(1);
    expect(rendered).toContain('Welcome to iKi');
    expect(rendered).toContain('amazon-bedrock');
    expect(rendered).not.toContain('Ollama');
    expect(getProviders().find(p => p.id === 'mistral')?.apiKey).toBe('sk-wizard-key');

    // Custom OpenAI Responses API & Anthropic Messages API presets
    const respIn = new PassThrough();
    const respOut = new PassThrough();
    respIn.end('custom_responses\nhttp://127.0.0.1:9000/v1\n\nmy-resp-model\n');
    const savedResp = await runCliOnboardingWizard({ dataDir, input: respIn, output: respOut });
    expect(savedResp).toMatchObject({
      type: 'openai-compatible',
      isResponseApi: true,
      baseUrl: 'http://127.0.0.1:9000/v1',
      models: ['my-resp-model'],
    });

    const anthIn = new PassThrough();
    const anthOut = new PassThrough();
    anthIn.end('custom_anthropic\nhttp://127.0.0.1:9001/v1\nsk-anth\nmy-claude-proxy\n');
    const savedAnth = await runCliOnboardingWizard({ dataDir, input: anthIn, output: anthOut });
    expect(savedAnth).toMatchObject({
      type: 'anthropic-compatible',
      baseUrl: 'http://127.0.0.1:9001/v1',
      models: ['my-claude-proxy'],
    });
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

  it('supports pi-tui fuzzy search, custom model fallback, and masked API key entry in setup steps', () => {
    let pickedValue = '';
    const picker = new SetupSearchListStep<string>({
      heading: 'Default Model',
      subtitle: 'Pick or type a model',
      placeholder: 'filter...',
      items: [
        { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro', data: 'gemini-2.5-pro' },
        { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6', data: 'claude-sonnet-4-6' },
      ],
      allowCustom: true,
      hint: 'Enter select',
      onSelect: p => {
        pickedValue = p.value;
      },
      onBack: () => {},
    });
    picker.focused = true;
    for (const ch of 'my-custom-v4') picker.handleInput(ch);
    picker.handleInput('\r');
    expect(pickedValue).toBe('my-custom-v4');

    let submittedKey = '';
    const keyStep = new SetupTextStep({
      heading: 'API Key',
      subtitle: 'Masked',
      prompt: ' API Key: ',
      placeholder: 'sk-...',
      masked: true,
      required: true,
      hint: 'Enter continue',
      onSubmit: val => {
        submittedKey = val;
      },
      onBack: () => {},
    });
    keyStep.focused = true;
    for (const ch of 'sk-secret-123') keyStep.handleInput(ch);
    const rendered = keyStep.render(80).join('\n');
    expect(rendered).toContain('•••••••••••••');
    expect(rendered).not.toContain('sk-secret-123');
    keyStep.handleInput('\r');
    expect(submittedKey).toBe('sk-secret-123');
  });
});
