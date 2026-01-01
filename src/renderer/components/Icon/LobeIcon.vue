<template>
  <img
    v-if="type === 'img'"
    :src="iconSrc"
    :alt="alt || name"
    :width="computedSize"
    :height="computedSize"
    :class="['lobe-icon', `lobe-icon-${name}`, className]"
    :style="iconStyle"
    @error="handleError"
    @load="handleLoad"
  />
  <svg
    v-else-if="type === 'svg' && svgContent"
    v-html="svgContent"
    :width="computedSize"
    :height="computedSize"
    :class="['lobe-icon', `lobe-icon-${name}`, className]"
    :style="iconStyle"
    @load="handleLoad"
  />
  <div v-else :class="['lobe-icon-placeholder', className]" :style="placeholderStyle">
    {{ fallbackText }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import type { CSSProperties } from 'vue';

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
  type?: 'img' | 'svg';
  useCdn?: boolean;
  cdnPrefix?: string;
  fallbackText?: string;
  style?: CSSProperties;
}

const props = withDefaults(defineProps<Props>(), {
  size: 24,
  className: '',
  alt: '',
  color: '',
  spin: false,
  type: 'img',
  useCdn: true,
  cdnPrefix: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons',
  fallbackText: '?',
  style: () => ({}),
});

const emit = defineEmits<{
  load: [event: Event];
  error: [event: Event | string];
}>();

const svgContent = ref<string>('');
const hasError = ref(false);

const computedSize = computed(() => {
  if (typeof props.size === 'number') {
    return `${props.size}px`;
  }
  return props.size;
});

const iconSrc = computed(() => {
  if (hasError.value) return '';

  if (props.useCdn) {
    return `${props.cdnPrefix}/${props.name}.svg`;
  }

  return `/icons/${props.name}.svg`;
});

const iconStyle = computed<CSSProperties>(() => ({
  ...props.style,
  color: props.color || undefined,
  animation: props.spin ? 'spin 1s linear infinite' : undefined,
  ...(props.type === 'img'
    ? {
        objectFit: 'contain',
        display: 'block',
      }
    : {}),
}));

const placeholderStyle = computed<CSSProperties>(() => ({
  width: computedSize.value,
  height: computedSize.value,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#f5f5f5',
  borderRadius: '4px',
  color: '#999',
  fontSize: '12px',
  ...props.style,
}));

const handleLoad = (event: Event) => {
  emit('load', event);
};

const handleError = (event: Event) => {
  hasError.value = true;
  emit('error', event);
};

const loadSvgContent = async () => {
  if (props.type !== 'svg') return;

  try {
    const response = await fetch(iconSrc.value);
    if (response.ok) {
      const svgText = await response.text();
      svgContent.value = svgText;
    } else {
      throw new Error(`Failed to load SVG: ${response.status}`);
    }
  } catch (error) {
    hasError.value = true;
    emit('error', error instanceof Error ? error.message : 'Failed to load SVG');
  }
};

watch(
  () => props.name,
  () => {
    hasError.value = false;
    if (props.type === 'svg') {
      loadSvgContent();
    }
  }
);

watch(
  () => props.type,
  newType => {
    if (newType === 'svg') {
      loadSvgContent();
    } else {
      svgContent.value = '';
    }
  }
);

onMounted(() => {
  if (props.type === 'svg') {
    loadSvgContent();
  }
});
</script>

<style scoped>
.lobe-icon {
  display: inline-block;
  vertical-align: middle;
  max-width: 100%;
  max-height: 100%;
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
