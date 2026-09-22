<template>
  <span
    v-if="svgMarkup"
    v-html="svgMarkup"
    role="img"
    :aria-label="alt || name"
    :class="['lobe-icon', `lobe-icon-${name}`, className]"
    :style="iconStyle"
  />
  <div v-else :class="['lobe-icon-placeholder', className]" :style="placeholderStyle">
    {{ fallbackText }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CSSProperties } from 'vue';
import { getIconSvg } from './icon_svg_assets';

export type IconName =
  | 'openai'
  | 'claude'
  | 'gemini'
  | 'grok'
  | 'mistral'
  | 'qwen'
  | 'anthropic'
  | 'google'
  | 'microsoft'
  | 'aws'
  | 'azure'
  | 'cursor'
  | 'vscode'
  | 'githubcopilot'
  | 'midjourney'
  | 'chatglm'
  | 'deepseek'
  | 'baichuan'
  | 'spark'
  | string; // 允许其他字符串

interface Props {
  name: IconName;
  size?: number | string;
  className?: string;
  alt?: string;
  color?: string;
  spin?: boolean;
  fallbackText?: string;
  style?: CSSProperties;
}

const props = withDefaults(defineProps<Props>(), {
  size: 24,
  className: '',
  alt: '',
  color: '',
  spin: false,
  fallbackText: '?',
  style: () => ({}),
});

const computedSize = computed(() => {
  if (typeof props.size === 'number') {
    return `${props.size}px`;
  }
  return props.size;
});

// An unknown name falls back to the initials placeholder — never a network fetch.
const svgMarkup = computed(() => getIconSvg(props.name));

const iconStyle = computed<CSSProperties>(() => ({
  ...props.style,
  width: computedSize.value,
  height: computedSize.value,
  color: props.color || undefined,
  animation: props.spin ? 'spin 1s linear infinite' : undefined,
}));

const placeholderStyle = computed<CSSProperties>(() => ({
  width: computedSize.value,
  height: computedSize.value,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'var(--bg-secondary)',
  borderRadius: '4px',
  color: 'var(--text-muted)',
  fontSize: '12px',
  ...props.style,
}));
</script>

<style scoped>
/* :deep() is required — v-html content carries no scope attribute. */
.lobe-icon {
  display: inline-flex;
  vertical-align: middle;
  flex: none;
}

.lobe-icon :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.lobe-icon-placeholder {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-weight: 500;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
