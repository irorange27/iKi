<template>
  <section class="config-section usage-section">
    <div class="settings-card">
      <div class="usage-toolbar">
        <div>
          <div class="card-title">{{ t('settings.usage.title') }}</div>
          <p class="card-help">{{ t('settings.usage.description') }}</p>
        </div>
        <div class="input-label usage-period-select">
          <span>{{ t('settings.usage.period') }}</span>
          <SettingsSelect
            :model-value="usagePeriod"
            :options="usagePeriodOptions"
            :aria-label="t('settings.usage.periodAria')"
            @update:model-value="updateUsagePeriod"
          />
        </div>
      </div>

      <p v-if="usageError" class="usage-error">{{ usageError }}</p>
      <div v-else-if="usageLoading" class="usage-empty">{{ t('settings.usage.loading') }}</div>
      <div v-else-if="usageSummary" class="usage-metrics-grid">
        <div class="usage-metric-card">
          <div class="usage-metric-label">{{ t('settings.usage.totalCost') }}</div>
          <div class="usage-metric-value">
            {{ formatUsageCost(usageSummary.totals.estimatedCostUsd) }}
          </div>
        </div>
        <div class="usage-metric-card">
          <div class="usage-metric-label">{{ t('settings.usage.messages') }}</div>
          <div class="usage-metric-value">{{ usageSummary.totals.messageCount }}</div>
        </div>
        <div class="usage-metric-card">
          <div class="usage-metric-label">{{ t('settings.usage.inputTokens') }}</div>
          <div class="usage-metric-value">
            {{ formatUsageTokens(usageSummary.totals.inputTokens) }}
          </div>
        </div>
        <div class="usage-metric-card">
          <div class="usage-metric-label">{{ t('settings.usage.outputTokens') }}</div>
          <div class="usage-metric-value">
            {{ formatUsageTokens(usageSummary.totals.outputTokens) }}
          </div>
        </div>
        <div class="usage-metric-card">
          <div class="usage-metric-label">{{ t('settings.usage.cacheRead') }}</div>
          <div class="usage-metric-value">
            {{ formatUsageTokens(usageSummary.totals.cacheReadTokens) }}
          </div>
        </div>
        <div class="usage-metric-card">
          <div class="usage-metric-label">{{ t('settings.usage.cacheWrite') }}</div>
          <div class="usage-metric-value">
            {{ formatUsageTokens(usageSummary.totals.cacheWriteTokens) }}
          </div>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <div class="card-title">{{ t('settings.usage.heatmapTitle') }}</div>
      <p class="card-help">{{ t('settings.usage.heatmapDescription') }}</p>

      <div v-if="usageLoading" class="usage-empty">{{ t('settings.usage.loadingHeatmap') }}</div>
      <div v-else-if="!usageSummary || usageHeatmapCells.length === 0" class="usage-empty">
        {{ t('settings.usage.empty') }}
      </div>
      <template v-else>
        <div class="usage-heatmap-months">
          <span
            v-for="marker in usageHeatmapMonthMarkers"
            :key="`${marker.column}_${marker.label}`"
            :style="{ gridColumnStart: marker.column + 1 }"
          >
            {{ marker.label }}
          </span>
        </div>
        <div class="usage-heatmap-grid">
          <div
            v-for="(column, columnIndex) in usageHeatmapColumns"
            :key="`col_${columnIndex}`"
            class="usage-heatmap-column"
          >
            <div
              v-for="cell in column"
              :key="cell.date"
              class="usage-heatmap-cell"
              :style="getHeatmapCellStyle(cell.totalTokens)"
              :title="
                t('settings.usage.heatmapCellTitle', {
                  date: formatUsageDate(cell.date),
                  tokens: cell.totalTokens,
                  messages: cell.messageCount,
                })
              "
            />
          </div>
        </div>
        <div class="usage-heatmap-footer">
          <span>
            {{ t('settings.usage.heatmapFooter', { tokens: formatUsageTokens(usagePastYearTokens) }) }}
          </span>
          <span class="usage-heatmap-legend">{{ t('settings.usage.heatmapLegend') }}</span>
        </div>
      </template>
    </div>

    <div class="settings-card">
      <div class="card-title">{{ t('settings.usage.costOverTime') }}</div>
      <p class="card-help">{{ t('settings.usage.costOverTimeDescription') }}</p>

      <div v-if="usageLoading" class="usage-empty">{{ t('settings.usage.loadingChart') }}</div>
      <div v-else-if="!usageSummary || usageSummary.monthly.length === 0" class="usage-empty">
        {{ t('settings.usage.noCostData') }}
      </div>
      <div v-else class="usage-monthly-chart">
        <div
          v-for="row in usageSummary.monthly"
          :key="row.month"
          class="usage-month-bar"
          :title="t('settings.usage.monthBarTitle', { month: row.month, cost: formatUsageCost(row.estimatedCostUsd) })"
        >
          <div class="usage-month-bar-fill" :style="getMonthlyCostBarStyle(row.estimatedCostUsd)" />
          <span class="usage-month-label">{{ row.month.slice(5) }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import SettingsSelect from './SettingsSelect.vue';
import { useI18n } from '../../i18n';
import type {
  ChatUsageHeatmapCell,
  ChatUsagePeriod,
  ChatUsageSummary,
} from '../../../shared/types/chat_usage';
import { getErrorMessage } from '../../../shared/utils/errors';

const props = defineProps<{
  active: boolean;
}>();
const electronAPI = window.electronAPI;
const { t, locale } = useI18n();

const usagePeriod = ref<ChatUsagePeriod>('30d');
const usageSummary = ref<ChatUsageSummary | null>(null);
const usageLoading = ref(false);
const usageError = ref('');

const usagePeriodOptions = computed(() => [
  { value: '7d', label: t('settings.usage.period.7d') },
  { value: '30d', label: t('settings.usage.period.30d') },
  { value: '90d', label: t('settings.usage.period.90d') },
  { value: '365d', label: t('settings.usage.period.365d') },
  { value: 'all', label: t('settings.usage.period.all') },
]);

const updateUsagePeriod = (value: string) => {
  usagePeriod.value = value as ChatUsagePeriod;
};

const usageHeatmapCells = computed<ChatUsageHeatmapCell[]>(() => usageSummary.value?.heatmap ?? []);

const usageHeatmapMaxTokens = computed(() => {
  const max = usageHeatmapCells.value.reduce((acc, cell) => Math.max(acc, cell.totalTokens), 0);
  return max > 0 ? max : 1;
});

const usageHeatmapColumns = computed(() => {
  const columns: ChatUsageHeatmapCell[][] = [];
  const cells = usageHeatmapCells.value;
  for (let index = 0; index < cells.length; index += 7) {
    columns.push(cells.slice(index, index + 7));
  }
  return columns;
});

const usageHeatmapMonthMarkers = computed(() => {
  const markers: Array<{ label: string; column: number }> = [];
  let previousMonth = '';
  usageHeatmapColumns.value.forEach((column, columnIndex) => {
    const first = column[0];
    if (!first) return;
    const date = new Date(`${first.date}T00:00:00.000Z`);
    const monthLabel = date.toLocaleString(locale.value, { month: 'short', timeZone: 'UTC' });
    const monthKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    if (monthKey !== previousMonth) {
      markers.push({ label: monthLabel, column: columnIndex });
      previousMonth = monthKey;
    }
  });
  return markers;
});

const usageMaxMonthlyCost = computed(() => {
  const monthly = usageSummary.value?.monthly ?? [];
  const max = monthly.reduce((acc, row) => Math.max(acc, row.estimatedCostUsd), 0);
  return max > 0 ? max : 1;
});

const usagePastYearTokens = computed(() =>
  usageHeatmapCells.value.reduce((sum, cell) => sum + cell.totalTokens, 0)
);

const formatUsageTokens = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value)}`;
};

const formatUsageCost = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '$0.000';
  return `$${value.toFixed(3)}`;
};

const formatUsageDate = (value: string): string => {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toLocaleDateString(locale.value, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
};

const getHeatmapCellStyle = (tokens: number): Record<string, string> => {
  const ratio = Math.max(0, Math.min(1, tokens / usageHeatmapMaxTokens.value));
  const alpha = ratio <= 0 ? 0.08 : 0.18 + ratio * 0.72;
  return {
    backgroundColor: `color-mix(in srgb, var(--accent-color) ${Math.round(alpha * 100)}%, var(--bg-primary))`,
  };
};

const getMonthlyCostBarStyle = (cost: number): Record<string, string> => {
  const ratio = Math.max(0, Math.min(1, cost / usageMaxMonthlyCost.value));
  return {
    height: `${Math.max(6, Math.round(ratio * 100))}%`,
  };
};

const loadUsageSummary = async () => {
  usageLoading.value = true;
  usageError.value = '';
  if (!electronAPI?.chat?.usage?.summary) {
    usageError.value = t('settings.usage.error.unavailable');
    usageLoading.value = false;
    return;
  }

  try {
    usageSummary.value = await electronAPI.chat.usage.summary(usagePeriod.value);
  } catch (error: unknown) {
    usageError.value = t('settings.usage.error.loadFailed', { error: getErrorMessage(error) });
  } finally {
    usageLoading.value = false;
  }
};

watch(
  () => props.active,
  active => {
    if (active) {
      void loadUsageSummary();
    }
  },
  { immediate: true }
);

watch(usagePeriod, () => {
  if (props.active) {
    void loadUsageSummary();
  }
});
</script>

<style scoped src="./settings_shared.css"></style>

<style scoped>
.usage-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.usage-period-select {
  width: 220px;
  margin-bottom: 0;
}

.usage-empty {
  color: var(--text-secondary);
  font-size: 0.95em;
  padding: 10px 2px;
}

.usage-error {
  color: var(--danger-color);
  font-size: 0.95em;
  margin: 10px 0 0;
}

.usage-metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.usage-metric-card {
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-secondary);
  padding: 14px;
}

.usage-metric-label {
  color: var(--text-secondary);
  font-size: 0.88em;
}

.usage-metric-value {
  font-size: 1.65em;
  font-weight: 700;
  margin-top: 8px;
  line-height: 1;
}

.usage-heatmap-months {
  display: grid;
  grid-template-columns: repeat(53, minmax(0, 1fr));
  font-size: 0.75em;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.usage-heatmap-months span {
  white-space: nowrap;
}

.usage-heatmap-grid {
  display: flex;
  gap: 4px;
  align-items: flex-start;
  overflow-x: auto;
  padding-bottom: 4px;
}

.usage-heatmap-column {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.usage-heatmap-cell {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-primary));
}

.usage-heatmap-footer {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--text-secondary);
  font-size: 0.85em;
}

.usage-heatmap-legend {
  letter-spacing: 0.03em;
}

.usage-monthly-chart {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  min-height: 180px;
  padding: 10px 6px 2px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-secondary);
}

.usage-month-bar {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  height: 160px;
}

.usage-month-bar-fill {
  width: 100%;
  max-width: 28px;
  border-radius: 8px 8px 4px 4px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent-color) 85%, white),
    color-mix(in srgb, var(--accent-color) 45%, var(--bg-primary))
  );
  border: 1px solid color-mix(in srgb, var(--accent-color) 35%, var(--border-color));
}

.usage-month-label {
  color: var(--text-secondary);
  font-size: 0.78em;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

@media (max-width: 840px) {
  .usage-metrics-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .usage-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .usage-period-select {
    width: 100%;
  }
}
</style>
