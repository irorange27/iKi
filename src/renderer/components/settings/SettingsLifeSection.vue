<template>
  <section class="config-section">
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
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import type { LifeOverview, LifePushPayload, LifeSnapshot } from '../../../shared/types/life';
import { getErrorMessage } from '../../../shared/utils/errors';
import { lifeService } from '../../services/life_service';
import { formatTimestamp } from './settings_formatters';

const props = defineProps<{
  active: boolean;
}>();

const loading = ref(false);
const errorText = ref('');
const overview = ref<LifeOverview | null>(null);

let pollTimer: ReturnType<typeof setInterval> | null = null;
let removePushListener: (() => void) | null = null;

const snapshot = computed<LifeSnapshot | null>(() => overview.value?.snapshot ?? null);
const recentEpisodes = computed(() => overview.value?.recentEpisodes ?? []);

const formatPercent = (value: number): string => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;

const loadOverview = async (limit = 8) => {
  loading.value = true;
  errorText.value = '';
  try {
    overview.value = await lifeService.getOverview(limit);
  } catch (error: unknown) {
    errorText.value = getErrorMessage(error);
    overview.value = null;
  } finally {
    loading.value = false;
  }
};

const refreshOverview = async () => {
  await loadOverview(8);
};

const forceRefresh = async () => {
  loading.value = true;
  errorText.value = '';
  try {
    await lifeService.refresh();
    overview.value = await lifeService.getOverview(8);
  } catch (error: unknown) {
    errorText.value = getErrorMessage(error);
  } finally {
    loading.value = false;
  }
};

const restartPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  if (!props.active) return;

  pollTimer = setInterval(() => {
    void loadOverview(8);
  }, 30_000);
};

const handleLifePush = (payload: LifePushPayload | unknown) => {
  if (!props.active) return;
  if (!payload || typeof payload !== 'object') {
    void loadOverview(8);
    return;
  }
  const record = payload as Partial<LifePushPayload>;
  if (record.type === 'life-state') {
    void loadOverview(8);
  }
};

watch(
  () => props.active,
  active => {
    restartPolling();
    if (active) {
      void loadOverview(8);
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
  background: color-mix(in srgb, var(--color-surface-elevated) 84%, transparent);
  border: 1px solid var(--color-border);
  font-size: 12px;
  text-transform: capitalize;
}

.life-chip-primary {
  background: color-mix(in srgb, var(--color-accent-primary) 14%, var(--color-surface-elevated));
  border-color: color-mix(in srgb, var(--color-accent-primary) 32%, var(--color-border));
}

.life-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.life-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-surface-elevated) 88%, transparent);
}

.life-stat-label,
.life-summary-label,
.life-episode-time {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.life-summary-block,
.life-episode-item {
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-surface-elevated) 88%, transparent);
}

.life-summary-block {
  margin-bottom: 12px;
}

.life-summary-text {
  margin-top: 6px;
  line-height: 1.5;
}

.life-meta-lines {
  display: grid;
  gap: 6px;
  color: var(--color-text-secondary);
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

@media (max-width: 720px) {
  .life-episode-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
