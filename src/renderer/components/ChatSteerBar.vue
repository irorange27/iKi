<template>
  <div v-if="props.visible" class="steer-bar">
    <form class="steer-form" @submit.prevent="submit">
      <input
        ref="inputRef"
        v-model="text"
        class="steer-input"
        type="text"
        :placeholder="t('chat.steer.placeholder')"
        :disabled="props.disabled"
        @keydown.escape="dismiss"
      />
      <button
        type="submit"
        class="steer-btn"
        :disabled="props.disabled || text.trim().length === 0"
        :title="t('chat.steer.send')"
      >
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  visible: boolean;
  disabled: boolean;
}>();

const emit = defineEmits<{
  (event: 'steer', message: string): void;
}>();

const text = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      text.value = '';
      await nextTick();
      inputRef.value?.focus();
    }
  }
);

onMounted(async () => {
  if (props.visible) {
    await nextTick();
    inputRef.value?.focus();
  }
});

const submit = () => {
  const trimmed = text.value.trim();
  if (!trimmed || props.disabled) return;
  emit('steer', trimmed);
  text.value = '';
};

const dismiss = () => {
  text.value = '';
  inputRef.value?.blur();
};

const t = (_key: string) => {
  const strings: Record<string, string> = {
    'chat.steer.placeholder': 'Steer the agent... (Enter to send, Esc to dismiss)',
    'chat.steer.send': 'Send steering message',
  };
  return strings[_key] || _key;
};
</script>

<style scoped>
.steer-bar {
  padding: 6px 10px;
  border-top: 1px solid rgba(var(--accent-rgb), 0.14);
  background: rgba(var(--accent-rgb), 0.04);
}

.steer-form {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 720px;
  margin: 0 auto;
}

.steer-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(var(--accent-rgb), 0.22);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  transition: border-color 0.18s ease;
}

.steer-input:focus {
  border-color: rgba(var(--accent-rgb), 0.48);
}

.steer-input::placeholder {
  color: var(--text-muted);
  font-size: 11px;
}

.steer-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(var(--accent-rgb), 0.22);
  border-radius: 8px;
  background: rgba(var(--accent-rgb), 0.1);
  color: var(--accent-color);
  flex-shrink: 0;
  cursor: pointer;
  transition: background 0.18s ease;
}

.steer-btn:hover:not(:disabled) {
  background: rgba(var(--accent-rgb), 0.2);
}

.steer-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
