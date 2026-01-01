<!-- Icon.vue -->
<template>
  <img :src="iconUrl" :alt="name" :width="size" :height="size" :class="['lobe-icon', className]" />
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  name: string;
  size?: number;
  className?: string;
  useCdn?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  size: 24,
  className: '',
  useCdn: true,
});

const iconUrl = computed(() => {
  if (props.useCdn) {
    return `https://unpkg.com/@lobehub/icons-static-svg@latest/icons/${props.name}.svg`;
  }
});
</script>

<style scoped>
.lobe-icon {
  display: inline-block;
  vertical-align: middle;
}
</style>
