<template>
  <div v-if="stats" class="session-stats-bar">
    <span v-if="roundsLabel" class="session-stats-segment" :title="roundsTitle">
      {{ roundsLabel }}
    </span>
    <span v-if="timingLabel" class="session-stats-segment">{{ timingLabel }}</span>
    <span v-if="speedLabel" class="session-stats-segment">{{ speedLabel }}</span>
    <span v-if="cacheLabel" class="session-stats-segment" :title="cacheTitle">
      {{ cacheLabel }}
    </span>
    <span v-if="tokensLabel" class="session-stats-segment" :title="tokensTitle">
      {{ tokensLabel }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../../i18n';
import { formatDurationMs } from '../../modules/chat/ui_message_tool_calls';
import type { SessionPerfStats } from '../../modules/chat/ui_message_references';

const props = defineProps<{ stats: SessionPerfStats | null }>();

const { t } = useI18n();

// 557K / 12.3M style compact counts — the bar is a glanceable summary, exact
// values stay available through per-message usage details.
const formatCompactTokens = (tokens: number): string => {
  const value = Math.max(0, Math.round(tokens));
  const trim = (text: string) => text.replace(/\.0$/, '');
  if (value >= 1_000_000) return `${trim((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${trim((value / 1_000).toFixed(1))}K`;
  return String(value);
};

const roundsLabel = computed(() => {
  const stats = props.stats;
  if (!stats) return '';
  return t('chat.sessionStats.roundsSteps', { rounds: stats.rounds, steps: stats.steps });
});

const roundsTitle = computed(() => {
  const stats = props.stats;
  if (!stats || stats.toolCalls <= 0) return '';
  return t('chat.sessionStats.tooltip.toolCalls', { count: stats.toolCalls });
});

const timingLabel = computed(() => {
  const stats = props.stats;
  if (!stats) return '';
  const parts: string[] = [];
  if (stats.llmMs > 0) {
    parts.push(t('chat.sessionStats.llmTime', { time: formatDurationMs(stats.llmMs) }));
  }
  if (stats.toolMs > 0) {
    parts.push(t('chat.sessionStats.toolTime', { time: formatDurationMs(stats.toolMs) }));
  }
  return parts.join(' · ');
});

const speedLabel = computed(() => {
  const stats = props.stats;
  if (!stats) return '';
  const parts: string[] = [];
  if (stats.avgFirstTokenMs !== null && stats.avgFirstTokenMs > 0) {
    parts.push(
      t('chat.sessionStats.firstTokenAvg', { time: formatDurationMs(stats.avgFirstTokenMs) })
    );
  }
  if (stats.tokensPerSecond !== null && stats.tokensPerSecond > 0) {
    parts.push(
      t('chat.sessionStats.tokensPerSecond', { speed: Math.round(stats.tokensPerSecond) })
    );
  }
  return parts.join(' · ');
});

const cacheLabel = computed(() => {
  const stats = props.stats;
  if (!stats) return '';
  const hasCacheData = stats.cacheReadTokens > 0 || stats.cacheWriteTokens > 0;
  if (!hasCacheData || stats.cacheHitPercent === null) return '';
  return t('chat.sessionStats.cacheHit', { percent: Math.round(stats.cacheHitPercent) });
});

const cacheTitle = computed(() => {
  const stats = props.stats;
  if (!stats || stats.cacheWriteTokens <= 0) return '';
  return t('chat.sessionStats.tooltip.cacheWriteTokens', {
    tokens: formatCompactTokens(stats.cacheWriteTokens),
  });
});

const tokensLabel = computed(() => {
  const stats = props.stats;
  if (!stats) return '';
  const parts: string[] = [];
  if (stats.inputTokens > 0) {
    parts.push(t('chat.sessionStats.inputTokens', { tokens: formatCompactTokens(stats.inputTokens) }));
  }
  if (stats.outputTokens > 0) {
    parts.push(
      t('chat.sessionStats.outputTokens', { tokens: formatCompactTokens(stats.outputTokens) })
    );
  }
  return parts.join(' · ');
});

const tokensTitle = computed(() => {
  const stats = props.stats;
  if (!stats) return '';
  const lines: string[] = [];
  if (stats.reasoningTokens > 0) {
    lines.push(
      t('chat.sessionStats.tooltip.reasoningTokens', {
        tokens: formatCompactTokens(stats.reasoningTokens),
      })
    );
  }
  if (stats.estimatedCostUsd > 0) {
    lines.push(t('chat.sessionStats.tooltip.cost', { cost: stats.estimatedCostUsd.toFixed(4) }));
  }
  if (stats.model) {
    lines.push(t('chat.contextUsage.model', { model: stats.model }));
  }
  return lines.join('\n');
});
</script>

<style scoped>
.session-stats-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  max-width: 860px;
  margin: 0 auto;
  padding: 2px 16px 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  user-select: none;
}

.session-stats-segment {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

.session-stats-segment:not(:first-child)::before {
  content: '';
  display: inline-block;
  width: 1px;
  height: 10px;
  background: var(--border-color);
  margin: 0 10px;
}
</style>
