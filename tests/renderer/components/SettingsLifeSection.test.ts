// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

import SettingsLifeSection from '../../../src/renderer/components/settings/SettingsLifeSection.vue';
import type { LifeOverview, LifePushPayload } from '../../../src/shared/types/life';
import type { RelationshipOverview } from '../../../src/shared/types/relationship';

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

const buildOverview = (overrides?: Partial<LifeOverview>): LifeOverview => ({
  snapshot: {
    state: {
      id: 'life_1',
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

const buildRelationshipOverview = (
  overrides?: Partial<RelationshipOverview>
): RelationshipOverview => ({
  owner: {
    owner_label: 'Nina',
    relationship_to_owner: 'trusted personal AI companion',
  },
  recentStates: [],
  ...overrides,
});

const mountSettingsLifeSection = async (
  overview: LifeOverview,
  relationshipOverview: RelationshipOverview = buildRelationshipOverview()
) => {
  const getOverview = vi.fn(async () => overview);
  const getRelationshipOverview = vi.fn(async () => relationshipOverview);
  const refresh = vi.fn(async () => overview.snapshot);
  const setOwnerMode = vi.fn(async () => overview.snapshot);
  const clearOwnerMode = vi.fn(async () => overview.snapshot);
  const onPush = vi.fn((callback: (payload: LifePushPayload | unknown) => void) => {
    void callback;
  });
  const removeAllListeners = vi.fn();

  setElectronApi({
    life: {
      getOverview,
      refresh,
      setOwnerMode,
      clearOwnerMode,
      onPush,
      removeAllListeners,
    },
    relationship: {
      getOverview: getRelationshipOverview,
    },
  });

  const wrapper = mount(SettingsLifeSection, {
    props: {
      active: true,
    },
  });

  await flushPromises();

  return {
    wrapper,
    getOverview,
    getRelationshipOverview,
    refresh,
    setOwnerMode,
    clearOwnerMode,
    onPush,
    removeAllListeners,
  };
};

describe('SettingsLifeSection', () => {
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
    const { wrapper, setOwnerMode, clearOwnerMode, getOverview } = await mountSettingsLifeSection(
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
    const { wrapper } = await mountSettingsLifeSection(
      buildOverview({
        snapshot: {
          ...buildOverview().snapshot,
          state: {
            ...buildOverview().snapshot!.state,
            current_activity: 'focused_work',
            presence: 'focused',
          },
          derived: {
            ...buildOverview().snapshot!.derived,
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

  it('renders owner baseline and recent thread relationship states', async () => {
    const { wrapper } = await mountSettingsLifeSection(
      buildOverview(),
      buildRelationshipOverview({
        owner: {
          owner_label: 'Nina',
          relationship_to_owner: 'co-evolving personal intelligence partner',
        },
        recentStates: [
          {
            id: 'rel_1',
            profile_id: 'identity_1',
            scope_type: 'thread',
            scope_id: 'thread_group_1',
            source_kind: 'napcat-group',
            subject_label: 'Project Group',
            relationship_summary:
              'Group thread for shared project coordination; do not assume one speaker represents the whole group.',
            preferred_address: 'Keep replies concise and legible for multiple participants.',
            boundaries_json: JSON.stringify(['Do not expose private owner context to the group.']),
            notes_json: JSON.stringify(['Recurring collaboration thread for release planning.']),
            metadata: '{}',
            last_interaction_at: '2026-03-21T14:10:00.000Z',
            created_at: '2026-03-21T14:00:00.000Z',
            updated_at: '2026-03-21T14:10:00.000Z',
          },
        ],
      })
    );

    expect(wrapper.text()).toContain('Relationship Memory');
    expect(wrapper.text()).toContain('Nina: co-evolving personal intelligence partner');
    expect(wrapper.text()).toContain('Project Group');
    expect(wrapper.text()).toContain('QQ group');
    expect(wrapper.text()).toContain('Do not expose private owner context to the group.');
    expect(wrapper.text()).toContain('Recurring collaboration thread for release planning.');
  });
});
