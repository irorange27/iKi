import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCompanionService } from '../../packages/desktop/src/main/services/companion/companion_service';
import type { AppConfig } from '@iki/backend/types/config';
import type { Provider } from '@iki/backend/types/provider';

const createProvider = (overrides: Partial<Provider> = {}): Provider => ({
  id: 'provider_1',
  name: 'OpenAI',
  type: 'openai',
  api_key: 'secret',
  models: '[]',
  model_options: '{}',
  base_url: '',
  enabled: true,
  created_at: '2026-04-12T00:00:00.000Z',
  updated_at: '2026-04-12T00:00:00.000Z',
  available_models: '[]',
  ...overrides,
});

describe('createCompanionService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-12T08:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays dormant until at least one enabled provider has a usable model', () => {
    let providers: Provider[] = [];
    const send = vi.fn();
    const service = createCompanionService({
      getConfig: () => ({ general: { language: 'en' } }) as Partial<AppConfig>,
      listProviders: () => providers,
      listWindows: () => [{ webContents: { send } }],
    });

    expect(service.getSnapshot()).toMatchObject({
      phase: 'dormant',
      dormantReason: 'provider_missing',
    });

    providers = [createProvider()];
    expect(service.refreshAvailability()).toMatchObject({
      phase: 'dormant',
      dormantReason: 'model_missing',
    });

    providers = [createProvider({ models: '["gpt-4o-mini"]' })];
    expect(service.refreshAvailability()).toMatchObject({
      phase: 'idle',
      label: 'Ready',
    });
    expect(send).toHaveBeenCalled();
  });

  it('prioritizes thinking over the idle phase and returns to idle afterwards', () => {
    const service = createCompanionService({
      getConfig: () => ({ general: { language: 'en' } }) as Partial<AppConfig>,
      listProviders: () => [createProvider({ models: '["gpt-4o-mini"]' })],
      listWindows: () => [],
    });

    expect(service.getSnapshot().phase).toBe('idle');

    service.beginThinking('renderer:1');
    expect(service.getSnapshot().phase).toBe('thinking');

    service.endThinking('renderer:1');
    expect(service.getSnapshot().phase).toBe('idle');
  });

  it('emits a transient nudge and then settles back to idle', () => {
    const service = createCompanionService({
      getConfig: () => ({ general: { language: 'zh-CN' } }) as Partial<AppConfig>,
      listProviders: () => [createProvider({ models: '["gpt-4o-mini"]' })],
      listWindows: () => [],
    });

    service.pushTaskNudge({
      kind: 'task-success',
      taskName: 'Daily digest',
    });

    expect(service.getSnapshot()).toMatchObject({
      phase: 'nudge',
      label: '完成',
      detail: 'Daily digest',
    });

    vi.advanceTimersByTime(12_000);
    expect(service.getSnapshot().phase).toBe('idle');
  });

  it('cleans up stale thinking keys so a missed endThinking does not permanently leak', () => {
    const service = createCompanionService({
      getConfig: () => ({ general: { language: 'en' } }) as Partial<AppConfig>,
      listProviders: () => [createProvider({ models: '["gpt-4o-mini"]' })],
      listWindows: () => [],
    });

    service.beginThinking('renderer:1');
    service.beginThinking('renderer:2');
    expect(service.getSnapshot().phase).toBe('thinking');

    service.endThinking('renderer:1');
    expect(service.getSnapshot().phase).toBe('thinking');

    vi.advanceTimersByTime(300_001);
    expect(service.getSnapshot().phase).toBe('idle');
  });
});
