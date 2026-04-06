// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

import SettingsPresenceSection from '../../../src/renderer/components/settings/SettingsPresenceSection.vue';
import type { PresenceOverview, PresencePushPayload } from '../../../src/shared/types/presence';

const setElectronApi = (api: unknown) => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
};

const findButtonByText = (wrapper: VueWrapper, text: string) => {
  const match = wrapper
    .findAll('button')
    .find(button => button.text().replace(/\s+/g, ' ').includes(text));

  if (!match) {
    throw new Error(`Button not found: ${text}`);
  }

  return match;
};

const buildOverview = (overrides?: Partial<PresenceOverview>): PresenceOverview => ({
  snapshot: {
    state: {
      id: 'presence_1',
      profile_id: 'identity_1',
      current_activity: 'companion_idle',
      presence: 'available',
      energy: 0.72,
      focus_budget: 0.68,
      social_availability: 0.81,
      current_episode_id: 'episode_1',
      next_review_at: '2026-03-21T15:00:00.000Z',
      sleep_window_json: '{"startHour":1,"endHour":9}',
      policy_version: 'life-kernel-v2',
      state_json: '{}',
      created_at: '2026-03-21T14:00:00.000Z',
      updated_at: '2026-03-21T14:00:00.000Z',
    },
    derived: {
      dayPhase: 'day',
      lastTransitionReason: 'idle-available',
      lastEventType: 'tick',
      runningTaskIds: [],
      ownerMode: null,
      ownerModeSetAt: null,
      ownerModeNote: null,
      ownerModeStatus: 'none',
    },
    currentEpisode: {
      id: 'episode_1',
      profile_id: 'identity_1',
      activity_type: 'companion_idle',
      presence: 'available',
      started_at: '2026-03-21T14:00:00.000Z',
      ended_at: null,
      transition_reason: 'idle-available',
      summary: 'Available and monitoring for user activity.',
      trigger_type: 'tick',
      trigger_ref: 'tick',
      thread_id: null,
      client_id: null,
      task_id: null,
      snapshot_json: '{}',
      created_at: '2026-03-21T14:00:00.000Z',
      updated_at: '2026-03-21T14:00:00.000Z',
    },
  },
  recentEpisodes: [],
  recentReflections: [],
  ...overrides,
});

const mountSettingsPresenceSection = async (overview: PresenceOverview) => {
  const getOverview = vi.fn(async () => overview);
  const refresh = vi.fn(async () => overview.snapshot);
  const setOwnerMode = vi.fn(async () => overview.snapshot);
  const clearOwnerMode = vi.fn(async () => overview.snapshot);
  const onPush = vi.fn((callback: (payload: PresencePushPayload | unknown) => void) => {
    void callback;
  });
  const removeAllListeners = vi.fn();

  setElectronApi({
    presence: {
      getOverview,
      refresh,
      setOwnerMode,
      clearOwnerMode,
      onPush,
      removeAllListeners,
    },
  });

  const wrapper = mount(SettingsPresenceSection, {
    props: {
      active: true,
    },
  });

  await flushPromises();

  return {
    wrapper,
    getOverview,
    refresh,
    setOwnerMode,
    clearOwnerMode,
    onPush,
    removeAllListeners,
  };
};

describe('SettingsPresenceSection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T14:00:00.000Z'));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('applies explicit owner mode actions through the life bridge', async () => {
    const { wrapper, setOwnerMode, clearOwnerMode, getOverview } = await mountSettingsPresenceSection(
      buildOverview()
    );

    await findButtonByText(wrapper, 'Focus').trigger('click');
    await flushPromises();

    expect(setOwnerMode).toHaveBeenCalledWith('focus', undefined);
    expect(getOverview).toHaveBeenCalledTimes(2);

    await findButtonByText(wrapper, 'Auto').trigger('click');
    await flushPromises();

    expect(clearOwnerMode).toHaveBeenCalledWith();
  });

  it('renders deferred owner mode status when a running task blocks the request', async () => {
    const baseOverview = buildOverview();
    if (!baseOverview.snapshot) {
      throw new Error('Expected snapshot in test fixture');
    }
    const { wrapper } = await mountSettingsPresenceSection(
      buildOverview({
        snapshot: {
          ...baseOverview.snapshot,
          state: {
            ...baseOverview.snapshot.state,
            current_activity: 'focused_work',
            presence: 'focused',
          },
          derived: {
            ...baseOverview.snapshot.derived,
            runningTaskIds: ['task_1'],
            ownerMode: 'sleep',
            ownerModeSetAt: '2026-03-21T14:05:00.000Z',
            ownerModeStatus: 'deferred',
          },
        },
      })
    );

    expect(wrapper.text()).toContain('Current owner mode');
    expect(wrapper.text()).toContain('Sleep');
    expect(wrapper.text()).toContain('deferred');
    expect(wrapper.text()).toContain('Waiting for the current task lock to clear');
  });

  it('renders structured reflection insights and next steps', async () => {
    const { wrapper } = await mountSettingsPresenceSection(
      buildOverview({
        recentReflections: [
          {
            id: 'reflection_1',
            profile_id: 'identity_1',
            period_type: 'day',
            period_start: '2026-03-21T00:00:00.000Z',
            period_end: '2026-03-21T23:59:59.000Z',
            summary: 'The day stayed coherent when active commitments were reviewed early.',
            insights_json: JSON.stringify([
              'Explicit commitment review reduced drift.',
              'Planning before new work improved follow-through.',
            ]),
            plan_json: JSON.stringify([
              'Finish inbox follow-ups before new proactive work.',
              'Review deferred tasks after the morning recap.',
            ]),
            created_at: '2026-03-21T23:59:59.000Z',
            updated_at: '2026-03-21T23:59:59.000Z',
          },
        ],
      })
    );

    expect(wrapper.text()).toContain('Recent Reflections');
    expect(wrapper.text()).toContain('Insights');
    expect(wrapper.text()).toContain('Explicit commitment review reduced drift.');
    expect(wrapper.text()).toContain('Next Day');
    expect(wrapper.text()).toContain('Finish inbox follow-ups before new proactive work.');
  });
});
