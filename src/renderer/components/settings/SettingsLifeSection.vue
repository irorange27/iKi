<template>
  <section class="config-section">
    <div class="settings-card">
      <div class="card-title">{{ t('settings.life.controlsTitle') }}</div>
      <p class="card-help">{{ t('settings.life.controlsDescription') }}</p>

      <p v-if="controlErrorText" class="tasks-error">{{ controlErrorText }}</p>

      <div class="life-summary-block">
        <div class="life-summary-label">{{ t('settings.life.currentOwnerMode') }}</div>
        <div class="life-summary-text">
          {{ ownerModeLabel }}
          <span v-if="snapshot?.derived.ownerMode" class="task-meta-label">
            ({{ formatOwnerStatus(snapshot?.derived.ownerModeStatus) }})
          </span>
        </div>
        <div class="life-meta-lines">
          <div v-if="snapshot?.derived.ownerModeSetAt">
            <span class="task-meta-label">{{ t('settings.life.setAt') }}:</span>
            {{ formatTimestamp(snapshot.derived.ownerModeSetAt) }}
          </div>
          <div v-if="snapshot?.derived.ownerModeStatus === 'deferred'">
            <span class="task-meta-label">{{ t('settings.life.deferred') }}:</span>
            {{ t('settings.life.deferredDescription') }}
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
          {{ controlLoading && pendingMode === null ? t('settings.life.applying') : t('settings.life.mode.auto') }}
        </button>
        <button
          class="secondary-btn"
          :class="{ 'secondary-btn-active': snapshot?.derived.ownerMode === 'sleep' }"
          :disabled="loading || controlLoading"
          @click="setOwnerMode('sleep')"
        >
          {{ controlLoading && pendingMode === 'sleep' ? t('settings.life.applying') : t('settings.life.mode.sleepNow') }}
        </button>
        <button
          class="secondary-btn"
          :class="{ 'secondary-btn-active': snapshot?.derived.ownerMode === 'focus' }"
          :disabled="loading || controlLoading"
          @click="setOwnerMode('focus')"
        >
          {{ controlLoading && pendingMode === 'focus' ? t('settings.life.applying') : t('settings.life.mode.focus') }}
        </button>
        <button
          class="secondary-btn"
          :class="{ 'secondary-btn-active': snapshot?.derived.ownerMode === 'available' }"
          :disabled="loading || controlLoading"
          @click="setOwnerMode('available')"
        >
          {{ controlLoading && pendingMode === 'available' ? t('settings.life.applying') : t('settings.life.mode.available') }}
        </button>
      </div>
    </div>

    <div class="settings-card">
      <div class="card-title">{{ t('settings.life.presenceTitle') }}</div>
      <p class="card-help">{{ t('settings.life.presenceDescription') }}</p>

      <div class="task-form-actions">
        <button class="secondary-btn" @click="refreshOverview" :disabled="loading">
          {{ loading ? t('settings.life.refreshing') : t('common.refresh') }}
        </button>
        <button class="secondary-btn" @click="forceRefresh" :disabled="loading">
          {{ t('settings.life.recomputeNow') }}
        </button>
      </div>

      <p v-if="errorText" class="tasks-error">{{ errorText }}</p>
      <div v-else-if="loading && !snapshot" class="tasks-empty">{{ t('settings.life.runtimeLoading') }}</div>
      <div v-else-if="!snapshot" class="tasks-empty">{{ t('settings.life.runtimeEmpty') }}</div>
      <template v-else>
        <div class="life-status-row">
          <span class="life-chip life-chip-primary">{{ formatPresence(snapshot.state.presence) }}</span>
          <span class="life-chip">{{ formatActivity(snapshot.state.current_activity) }}</span>
          <span class="life-chip">{{ formatDayPhase(snapshot.derived.dayPhase) }}</span>
          <span v-if="snapshot.derived.ownerMode" class="life-chip">
            {{
              t('settings.life.ownerChip', {
                mode: formatOwnerMode(snapshot.derived.ownerMode),
                status: formatOwnerStatus(snapshot.derived.ownerModeStatus),
              })
            }}
          </span>
        </div>

        <div class="life-grid">
          <div class="life-stat">
            <span class="life-stat-label">{{ t('settings.life.energy') }}</span>
            <strong>{{ formatPercent(snapshot.state.energy) }}</strong>
          </div>
          <div class="life-stat">
            <span class="life-stat-label">{{ t('settings.life.focus') }}</span>
            <strong>{{ formatPercent(snapshot.state.focus_budget) }}</strong>
          </div>
          <div class="life-stat">
            <span class="life-stat-label">{{ t('settings.life.social') }}</span>
            <strong>{{ formatPercent(snapshot.state.social_availability) }}</strong>
          </div>
          <div class="life-stat">
            <span class="life-stat-label">{{ t('settings.life.nextReview') }}</span>
            <strong>{{
              snapshot.state.next_review_at
                ? formatTimestamp(snapshot.state.next_review_at)
                : t('settings.memory.na')
            }}</strong>
          </div>
        </div>

        <div class="life-summary-block">
          <div class="life-summary-label">{{ t('settings.life.currentTrajectory') }}</div>
          <div class="life-summary-text">
            {{ snapshot.currentEpisode?.summary || t('settings.life.noEpisodeSummary') }}
          </div>
        </div>

        <div class="life-meta-lines">
          <div v-if="snapshot.derived.lastTransitionReason">
            <span class="task-meta-label">{{ t('settings.life.transition') }}:</span>
            {{ snapshot.derived.lastTransitionReason }}
          </div>
          <div v-if="snapshot.derived.runningTaskIds.length > 0">
            <span class="task-meta-label">{{ t('settings.life.runningTasks') }}:</span>
            {{ snapshot.derived.runningTaskIds.join(', ') }}
          </div>
        </div>
      </template>
    </div>

    <div class="settings-card">
      <div class="card-title">{{ t('settings.life.episodesTitle') }}</div>
      <p class="card-help">{{ t('settings.life.episodesDescription') }}</p>

      <div v-if="recentEpisodes.length === 0" class="tasks-empty">{{ t('settings.life.noEpisodes') }}</div>
      <div v-else class="life-episode-list">
        <div v-for="episode in recentEpisodes" :key="episode.id" class="life-episode-item">
          <div class="life-episode-head">
            <div class="task-item-title">
              <span class="task-name">{{ formatActivity(episode.activity_type) }}</span>
              <span class="task-status status-idle">{{ formatPresence(episode.presence) }}</span>
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
              <span class="task-meta-label">{{ t('settings.life.reason') }}:</span>
              {{ episode.transition_reason }}
            </div>
            <div v-if="episode.task_id">
              <span class="task-meta-label">{{ t('settings.life.task') }}:</span>
              {{ episode.task_id }}
            </div>
            <div v-if="episode.thread_id">
              <span class="task-meta-label">{{ t('common.thread') }}:</span>
              {{ episode.thread_id }}
            </div>
            <div v-if="episode.ended_at">
              <span class="task-meta-label">{{ t('settings.life.ended') }}:</span>
              {{ formatTimestamp(episode.ended_at) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <div class="card-title">{{ t('settings.life.reflectionsTitle') }}</div>
      <p class="card-help">{{ t('settings.life.reflectionsDescription') }}</p>

      <div v-if="recentReflections.length === 0" class="tasks-empty">{{ t('settings.life.noReflections') }}</div>
      <div v-else class="life-episode-list">
        <div v-for="reflection in recentReflections" :key="reflection.id" class="life-episode-item">
          <div class="life-episode-head">
            <div class="task-item-title">
              <span class="task-name">{{ formatReflectionPeriod(reflection.period_type) }}</span>
              <span class="task-status status-success">{{ t('settings.life.reflectionLabel') }}</span>
            </div>
            <div class="life-episode-time">
              {{ formatTimestamp(reflection.period_start) }} -> {{ formatTimestamp(reflection.period_end) }}
            </div>
          </div>

          <div class="life-episode-body">
            <div>{{ reflection.summary }}</div>
          </div>

          <div v-if="parseList(reflection.insights_json).length > 0" class="life-summary-block mini-block">
            <div class="life-summary-label">{{ t('settings.life.insights') }}</div>
            <div class="life-list">
              <div v-for="item in parseList(reflection.insights_json)" :key="item">{{ item }}</div>
            </div>
          </div>

          <div v-if="parseList(reflection.plan_json).length > 0" class="life-summary-block mini-block">
            <div class="life-summary-label">
              {{ reflection.period_type === 'day' ? t('settings.life.nextDay') : t('settings.life.nextFocus') }}
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

import { useI18n } from '../../i18n';
import type {
  LifeOverview,
  LifeOwnerMode,
  LifePushPayload,
  LifeSnapshot,
} from '../../../shared/types/life';
import { getErrorMessage } from '../../../shared/utils/errors';
import { lifeService } from '../../services/life_service';
import { formatTimestamp } from './settings_formatters';

const props = defineProps<{
  active: boolean;
}>();
const { t } = useI18n();

const loading = ref(false);
const controlLoading = ref(false);
const errorText = ref('');
const controlErrorText = ref('');
const lifeOverview = ref<LifeOverview | null>(null);
const pendingMode = ref<LifeOwnerMode | null | undefined>(undefined);
const overviewLimit = 8;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let removePushListener: (() => void) | null = null;

const snapshot = computed<LifeSnapshot | null>(() => lifeOverview.value?.snapshot ?? null);
const recentEpisodes = computed(() => lifeOverview.value?.recentEpisodes ?? []);
const recentReflections = computed(() => lifeOverview.value?.recentReflections ?? []);
const formatOwnerMode = (mode: LifeOwnerMode | null | undefined): string => {
  if (!mode) return t('settings.life.mode.auto');
  if (mode === 'sleep') return t('settings.life.mode.sleep');
  if (mode === 'focus') return t('settings.life.mode.focus');
  return t('settings.life.mode.available');
};
const formatOwnerStatus = (status: string | null | undefined): string => {
  if (status === 'applied') return t('settings.life.ownerStatus.applied');
  if (status === 'deferred') return t('settings.life.ownerStatus.deferred');
  return t('settings.life.ownerStatus.none');
};
const formatPresence = (presence: string | null | undefined): string => {
  if (presence === 'sleeping') return t('settings.life.presence.sleeping');
  if (presence === 'waking') return t('settings.life.presence.waking');
  if (presence === 'available') return t('settings.life.presence.available');
  if (presence === 'focused') return t('settings.life.presence.focused');
  if (presence === 'maintaining') return t('settings.life.presence.maintaining');
  if (presence === 'recovering') return t('settings.life.presence.recovering');
  return presence || t('common.unknown');
};
const formatActivity = (activity: string | null | undefined): string => {
  if (activity === 'sleep') return t('settings.life.activity.sleep');
  if (activity === 'wake_transition') return t('settings.life.activity.wake_transition');
  if (activity === 'companion_idle') return t('settings.life.activity.companion_idle');
  if (activity === 'focused_work') return t('settings.life.activity.focused_work');
  if (activity === 'maintenance') return t('settings.life.activity.maintenance');
  if (activity === 'recovery') return t('settings.life.activity.recovery');
  return activity || t('common.unknown');
};
const formatDayPhase = (phase: string | null | undefined): string => {
  if (phase === 'night') return t('settings.life.dayPhase.night');
  if (phase === 'wake') return t('settings.life.dayPhase.wake');
  if (phase === 'day') return t('settings.life.dayPhase.day');
  if (phase === 'evening') return t('settings.life.dayPhase.evening');
  return phase || t('common.unknown');
};
const formatReflectionPeriod = (period: string | null | undefined): string => {
  if (period === 'day') return t('settings.life.period.day');
  if (period === 'hour') return t('settings.life.period.hour');
  return period || t('common.unknown');
};
const ownerModeLabel = computed(() => {
  return formatOwnerMode(snapshot.value?.derived.ownerMode);
});

const formatPercent = (value: number): string => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;

const loadState = async (limit = overviewLimit, options?: { showLoading?: boolean }) => {
  const showLoading = options?.showLoading ?? true;
  if (showLoading) {
    loading.value = true;
  }
  errorText.value = '';
  const lifeResult = await lifeService.getOverview(limit).then(
    value => ({ status: 'fulfilled', value } as const),
    reason => ({ status: 'rejected', reason } as const)
  );

  if (lifeResult.status === 'fulfilled') {
    lifeOverview.value = lifeResult.value;
  } else {
    errorText.value = getErrorMessage(lifeResult.reason);
    lifeOverview.value = null;
  }

  loading.value = false;
};

const refreshOverview = async () => {
  await loadState();
};

const forceRefresh = async () => {
  loading.value = true;
  errorText.value = '';
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

@media (max-width: 720px) {
  .life-episode-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
