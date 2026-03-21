<template>
  <section class="config-section">
    <div class="settings-card">
      <div class="card-title">Owner Controls</div>
      <p class="card-help">
        Explicit mode controls override the normal day rhythm, but never lie about a currently
        running task. If a task is active, the requested mode is kept and applied as soon as the
        task lock clears.
      </p>

      <p v-if="controlErrorText" class="tasks-error">{{ controlErrorText }}</p>

      <div class="life-summary-block">
        <div class="life-summary-label">Current owner mode</div>
        <div class="life-summary-text">
          {{ ownerModeLabel }}
          <span v-if="snapshot?.derived.ownerMode" class="task-meta-label">
            ({{ snapshot?.derived.ownerModeStatus }})
          </span>
        </div>
        <div class="life-meta-lines">
          <div v-if="snapshot?.derived.ownerModeSetAt">
            <span class="task-meta-label">Set:</span>
            {{ formatTimestamp(snapshot.derived.ownerModeSetAt) }}
          </div>
          <div v-if="snapshot?.derived.ownerModeStatus === 'deferred'">
            <span class="task-meta-label">Deferred:</span>
            Waiting for the current task lock to clear before the requested mode can fully apply.
          </div>
        </div>
      </div>

      <div class="life-control-grid">
        <button
          class="secondary-btn"
          :class="{ 'secondary-btn-active': !snapshot?.derived.ownerMode }"
          :disabled="loading || controlLoading"
          @click="clearOwnerMode"
        >
          {{ controlLoading && pendingMode === null ? 'Applying...' : 'Auto' }}
        </button>
        <button
          class="secondary-btn"
          :class="{ 'secondary-btn-active': snapshot?.derived.ownerMode === 'sleep' }"
          :disabled="loading || controlLoading"
          @click="setOwnerMode('sleep')"
        >
          {{ controlLoading && pendingMode === 'sleep' ? 'Applying...' : 'Sleep Now' }}
        </button>
        <button
          class="secondary-btn"
          :class="{ 'secondary-btn-active': snapshot?.derived.ownerMode === 'focus' }"
          :disabled="loading || controlLoading"
          @click="setOwnerMode('focus')"
        >
          {{ controlLoading && pendingMode === 'focus' ? 'Applying...' : 'Focus' }}
        </button>
        <button
          class="secondary-btn"
          :class="{ 'secondary-btn-active': snapshot?.derived.ownerMode === 'available' }"
          :disabled="loading || controlLoading"
          @click="setOwnerMode('available')"
        >
          {{ controlLoading && pendingMode === 'available' ? 'Applying...' : 'Stay Available' }}
        </button>
      </div>
    </div>

    <div class="settings-card">
      <div class="card-title">Current Presence</div>
      <p class="card-help">
        Read-only view of iKi's daemon-owned life state. This should reflect one shared presence
        across threads instead of per-thread roleplay.
      </p>

      <div class="task-form-actions">
        <button class="secondary-btn" @click="refreshOverview" :disabled="loading">
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </button>
        <button class="secondary-btn" @click="forceRefresh" :disabled="loading">
          Recompute Now
        </button>
      </div>

      <p v-if="errorText" class="tasks-error">{{ errorText }}</p>
      <div v-else-if="loading && !snapshot" class="tasks-empty">Loading...</div>
      <div v-else-if="!snapshot" class="tasks-empty">Life runtime has not produced a state yet.</div>
      <template v-else>
        <div class="life-status-row">
          <span class="life-chip life-chip-primary">{{ snapshot.state.presence }}</span>
          <span class="life-chip">{{ snapshot.state.current_activity }}</span>
          <span class="life-chip">{{ snapshot.derived.dayPhase }}</span>
          <span v-if="snapshot.derived.ownerMode" class="life-chip">
            owner: {{ snapshot.derived.ownerMode }} ({{ snapshot.derived.ownerModeStatus }})
          </span>
        </div>

        <div class="life-grid">
          <div class="life-stat">
            <span class="life-stat-label">Energy</span>
            <strong>{{ formatPercent(snapshot.state.energy) }}</strong>
          </div>
          <div class="life-stat">
            <span class="life-stat-label">Focus</span>
            <strong>{{ formatPercent(snapshot.state.focus_budget) }}</strong>
          </div>
          <div class="life-stat">
            <span class="life-stat-label">Social</span>
            <strong>{{ formatPercent(snapshot.state.social_availability) }}</strong>
          </div>
          <div class="life-stat">
            <span class="life-stat-label">Next Review</span>
            <strong>{{ snapshot.state.next_review_at ? formatTimestamp(snapshot.state.next_review_at) : 'n/a' }}</strong>
          </div>
        </div>

        <div class="life-summary-block">
          <div class="life-summary-label">Current trajectory</div>
          <div class="life-summary-text">
            {{ snapshot.currentEpisode?.summary || 'No active episode summary yet.' }}
          </div>
        </div>

        <div class="life-meta-lines">
          <div v-if="snapshot.derived.lastTransitionReason">
            <span class="task-meta-label">Transition:</span>
            {{ snapshot.derived.lastTransitionReason }}
          </div>
          <div v-if="snapshot.derived.runningTaskIds.length > 0">
            <span class="task-meta-label">Running tasks:</span>
            {{ snapshot.derived.runningTaskIds.join(', ') }}
          </div>
        </div>
      </template>
    </div>

    <div class="settings-card">
      <div class="card-title">Relationship Memory</div>
      <p class="card-help">
        Structured relationship state keeps owner baseline and thread-level context separate from
        generic long memory. This is the persistent social frame iKi should carry across access
        layers.
      </p>

      <p v-if="relationshipErrorText" class="tasks-error">{{ relationshipErrorText }}</p>
      <template v-else-if="relationshipOverview">
        <div class="life-summary-block">
          <div class="life-summary-label">Owner baseline</div>
          <div class="life-summary-text">
            {{ relationshipOverview.owner.owner_label }}: {{
              relationshipOverview.owner.relationship_to_owner
            }}
          </div>
        </div>

        <div v-if="recentRelationshipStates.length === 0" class="tasks-empty">
          No thread relationship states yet.
        </div>
        <div v-else class="life-episode-list">
          <div
            v-for="state in recentRelationshipStates"
            :key="state.id"
            class="life-episode-item"
          >
            <div class="life-episode-head">
              <div class="task-item-title relationship-title">
                <span class="task-name">{{ state.subject_label || state.scope_id }}</span>
                <span class="life-chip">{{ formatRelationshipSource(state.source_kind) }}</span>
              </div>
              <div class="life-episode-time">
                {{
                  state.last_interaction_at
                    ? formatTimestamp(state.last_interaction_at)
                    : 'No interaction yet'
                }}
              </div>
            </div>

            <div class="life-episode-body">
              <div>{{ state.relationship_summary }}</div>
            </div>

            <div v-if="state.preferred_address" class="life-meta-lines">
              <div>
                <span class="task-meta-label">Preferred address:</span>
                {{ state.preferred_address }}
              </div>
            </div>

            <div v-if="parseList(state.boundaries_json).length > 0" class="life-summary-block mini-block">
              <div class="life-summary-label">Boundaries</div>
              <div class="life-list">
                <div v-for="item in parseList(state.boundaries_json)" :key="item">{{ item }}</div>
              </div>
            </div>

            <div v-if="parseList(state.notes_json).length > 0" class="life-summary-block mini-block">
              <div class="life-summary-label">Notes</div>
              <div class="life-list">
                <div v-for="item in parseList(state.notes_json)" :key="item">{{ item }}</div>
              </div>
            </div>

            <div class="life-meta-lines">
              <div>
                <span class="task-meta-label">Thread:</span>
                {{ state.scope_id }}
              </div>
              <div>
                <span class="task-meta-label">Updated:</span>
                {{ formatTimestamp(state.updated_at) }}
              </div>
            </div>
          </div>
        </div>
      </template>
      <div v-else-if="loading" class="tasks-empty">Loading...</div>
      <div v-else class="tasks-empty">Relationship memory has not produced any state yet.</div>
    </div>

    <div class="settings-card">
      <div class="card-title">Recent Episodes</div>
      <p class="card-help">
        The recent trajectory log should explain what iKi has been occupied with, without inventing
        physical routines.
      </p>

      <div v-if="recentEpisodes.length === 0" class="tasks-empty">No episodes yet.</div>
      <div v-else class="life-episode-list">
        <div v-for="episode in recentEpisodes" :key="episode.id" class="life-episode-item">
          <div class="life-episode-head">
            <div class="task-item-title">
              <span class="task-name">{{ episode.activity_type }}</span>
              <span class="task-status status-idle">{{ episode.presence }}</span>
            </div>
            <div class="life-episode-time">
              {{ formatTimestamp(episode.started_at) }}
            </div>
          </div>

          <div class="life-episode-body">
            <div>{{ episode.summary || episode.transition_reason }}</div>
          </div>

          <div class="life-meta-lines">
            <div>
              <span class="task-meta-label">Reason:</span>
              {{ episode.transition_reason }}
            </div>
            <div v-if="episode.task_id">
              <span class="task-meta-label">Task:</span>
              {{ episode.task_id }}
            </div>
            <div v-if="episode.thread_id">
              <span class="task-meta-label">Thread:</span>
              {{ episode.thread_id }}
            </div>
            <div v-if="episode.ended_at">
              <span class="task-meta-label">Ended:</span>
              {{ formatTimestamp(episode.ended_at) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <div class="card-title">Recent Reflections</div>
      <p class="card-help">
        Hourly and daily synthesis windows generated from the life trajectory and active
        commitments. These are structured recap records, not chat messages.
      </p>

      <div v-if="recentReflections.length === 0" class="tasks-empty">No reflections yet.</div>
      <div v-else class="life-episode-list">
        <div v-for="reflection in recentReflections" :key="reflection.id" class="life-episode-item">
          <div class="life-episode-head">
            <div class="task-item-title">
              <span class="task-name">{{ reflection.period_type }}</span>
              <span class="task-status status-success">reflection</span>
            </div>
            <div class="life-episode-time">
              {{ formatTimestamp(reflection.period_start) }} -> {{ formatTimestamp(reflection.period_end) }}
            </div>
          </div>

          <div class="life-episode-body">
            <div>{{ reflection.summary }}</div>
          </div>

          <div v-if="parseList(reflection.insights_json).length > 0" class="life-summary-block mini-block">
            <div class="life-summary-label">Insights</div>
            <div class="life-list">
              <div v-for="item in parseList(reflection.insights_json)" :key="item">{{ item }}</div>
            </div>
          </div>

          <div v-if="parseList(reflection.plan_json).length > 0" class="life-summary-block mini-block">
            <div class="life-summary-label">
              {{ reflection.period_type === 'day' ? 'Next Day' : 'Next Focus' }}
            </div>
            <div class="life-list">
              <div v-for="item in parseList(reflection.plan_json)" :key="item">{{ item }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import type {
  LifeOverview,
  LifeOwnerMode,
  LifePushPayload,
  LifeSnapshot,
} from '../../../shared/types/life';
import type { RelationshipOverview, RelationshipSourceKind } from '../../../shared/types/relationship';
import { getErrorMessage } from '../../../shared/utils/errors';
import { lifeService } from '../../services/life_service';
import { relationshipService } from '../../services/relationship_service';
import { formatTimestamp } from './settings_formatters';

const props = defineProps<{
  active: boolean;
}>();

const loading = ref(false);
const controlLoading = ref(false);
const errorText = ref('');
const controlErrorText = ref('');
const relationshipErrorText = ref('');
const lifeOverview = ref<LifeOverview | null>(null);
const relationshipOverview = ref<RelationshipOverview | null>(null);
const pendingMode = ref<LifeOwnerMode | null | undefined>(undefined);
const overviewLimit = 8;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let removePushListener: (() => void) | null = null;

const snapshot = computed<LifeSnapshot | null>(() => lifeOverview.value?.snapshot ?? null);
const recentEpisodes = computed(() => lifeOverview.value?.recentEpisodes ?? []);
const recentReflections = computed(() => lifeOverview.value?.recentReflections ?? []);
const recentRelationshipStates = computed(() => relationshipOverview.value?.recentStates ?? []);
const ownerModeLabel = computed(() => {
  const mode = snapshot.value?.derived.ownerMode;
  if (!mode) return 'Auto';
  if (mode === 'sleep') return 'Sleep';
  if (mode === 'focus') return 'Focus';
  return 'Stay Available';
});

const formatPercent = (value: number): string => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
const parseList = (raw: string | null | undefined): string[] => {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [];
  } catch {
    return [];
  }
};

const formatRelationshipSource = (sourceKind: RelationshipSourceKind): string => {
  if (sourceKind === 'desktop-owner-thread') return 'Desktop owner';
  if (sourceKind === 'napcat-private') return 'QQ private';
  if (sourceKind === 'napcat-group') return 'QQ group';
  if (sourceKind === 'external-client-thread') return 'External client';
  return 'Unknown';
};

const loadState = async (limit = overviewLimit, options?: { showLoading?: boolean }) => {
  const showLoading = options?.showLoading ?? true;
  if (showLoading) {
    loading.value = true;
  }
  errorText.value = '';
  relationshipErrorText.value = '';

  const [lifeResult, relationshipResult] = await Promise.allSettled([
    lifeService.getOverview(limit),
    relationshipService.getOverview(limit),
  ]);

  if (lifeResult.status === 'fulfilled') {
    lifeOverview.value = lifeResult.value;
  } else {
    errorText.value = getErrorMessage(lifeResult.reason);
    lifeOverview.value = null;
  }

  if (relationshipResult.status === 'fulfilled') {
    relationshipOverview.value = relationshipResult.value;
  } else {
    relationshipErrorText.value = getErrorMessage(relationshipResult.reason);
    relationshipOverview.value = null;
  }

  loading.value = false;
};

const refreshOverview = async () => {
  await loadState();
};

const forceRefresh = async () => {
  loading.value = true;
  errorText.value = '';
  relationshipErrorText.value = '';
  try {
    await lifeService.refresh();
  } catch (error: unknown) {
    errorText.value = getErrorMessage(error);
  }
  await loadState(overviewLimit, { showLoading: false });
};

const setOwnerMode = async (mode: LifeOwnerMode) => {
  controlLoading.value = true;
  controlErrorText.value = '';
  pendingMode.value = mode;
  try {
    await lifeService.setOwnerMode(mode);
    await loadState(overviewLimit, { showLoading: false });
  } catch (error: unknown) {
    controlErrorText.value = getErrorMessage(error);
  } finally {
    controlLoading.value = false;
    pendingMode.value = undefined;
  }
};

const clearOwnerMode = async () => {
  controlLoading.value = true;
  controlErrorText.value = '';
  pendingMode.value = null;
  try {
    await lifeService.clearOwnerMode();
    await loadState(overviewLimit, { showLoading: false });
  } catch (error: unknown) {
    controlErrorText.value = getErrorMessage(error);
  } finally {
    controlLoading.value = false;
    pendingMode.value = undefined;
  }
};

const restartPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  if (!props.active) return;

  pollTimer = setInterval(() => {
    void loadState(overviewLimit, { showLoading: false });
  }, 30_000);
};

const handleLifePush = (payload: LifePushPayload | unknown) => {
  if (!props.active) return;
  if (!payload || typeof payload !== 'object') {
    void loadState(overviewLimit, { showLoading: false });
    return;
  }
  const record = payload as Partial<LifePushPayload>;
  if (record.type === 'life-state') {
    void loadState(overviewLimit, { showLoading: false });
  }
};

watch(
  () => props.active,
  active => {
    restartPolling();
    if (active) {
      void loadState();
    }
  },
  { immediate: true }
);

onMounted(() => {
  removePushListener = lifeService.onPush(handleLifePush);
});

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  removePushListener?.();
});
</script>

<style scoped src="./settings_shared.css"></style>

<style scoped>
.life-status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

.life-chip {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  font-size: 12px;
  text-transform: capitalize;
}

.life-chip-primary {
  background: color-mix(in srgb, var(--accent-color) 14%, var(--bg-secondary));
  border-color: color-mix(in srgb, var(--accent-color) 32%, var(--border-color));
}

.life-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.life-control-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}

.life-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.life-stat-label,
.life-summary-label,
.life-episode-time {
  font-size: 12px;
  color: var(--text-secondary);
}

.life-summary-block,
.life-episode-item {
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.life-summary-block {
  margin-bottom: 12px;
}

.mini-block {
  margin-bottom: 10px;
}

.life-summary-text {
  margin-top: 6px;
  line-height: 1.5;
}

.life-meta-lines {
  display: grid;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 13px;
}

.life-episode-list {
  display: grid;
  gap: 12px;
}

.life-episode-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.life-episode-body {
  margin-bottom: 10px;
  line-height: 1.5;
}

.life-list {
  display: grid;
  gap: 6px;
  margin-top: 6px;
  line-height: 1.4;
}

.secondary-btn-active {
  border-color: color-mix(in srgb, var(--accent-color) 34%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 14%, var(--bg-secondary));
}

.relationship-title {
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 720px) {
  .life-episode-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
