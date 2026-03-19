<template>
  <section class="config-section bridges-section">
    <div class="config-group">
      <h3>NapCat (QQ)</h3>
      <p class="group-description">
        Configure the reverse WebSocket bridge exposed by the daemon at
        <code>ws://127.0.0.1:6127/onebot/v11/ws</code>.
      </p>

      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="napcat.enabled"
          @change="updateNapCat('enabled', ($event.target as HTMLInputElement).checked)"
        />
        Enable NapCat reverse WebSocket bridge
      </label>

      <label class="input-label">
        <span>Access Token (optional)</span>
        <input
          type="password"
          :value="napcat.accessToken"
          placeholder="Leave empty to disable bridge auth"
          @input="updateNapCat('accessToken', ($event.target as HTMLInputElement).value)"
        />
        <small class="input-help">
          If set, NapCat must connect with <code>?access_token=...</code>.
        </small>
      </label>

      <div class="config-inline">
        <label class="input-label">
          <span>Provider Type</span>
          <select
            :value="napcat.providerType"
            @change="updateNapCat('providerType', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Auto-select first enabled provider</option>
            <option
              v-for="provider in providerOptions"
              :key="provider.type"
              :value="provider.type"
            >
              {{ provider.label }}
            </option>
          </select>
        </label>

        <label class="input-label">
          <span>Model</span>
          <input
            list="napcat-model-options"
            type="text"
            :value="napcat.model"
            placeholder="Leave empty to use the provider default"
            @input="updateNapCat('model', ($event.target as HTMLInputElement).value)"
          />
          <datalist id="napcat-model-options">
            <option v-for="model in selectedProviderModels" :key="model" :value="model" />
          </datalist>
        </label>
      </div>

      <p v-if="providersLoading" class="group-description">Loading enabled providers...</p>
      <p v-else-if="providersError" class="error-text">{{ providersError }}</p>
      <p v-else-if="providerOptions.length === 0" class="group-description warning-text">
        No enabled providers with model metadata are available. The bridge will not be able to
        generate replies until at least one provider is configured.
      </p>
      <p v-else-if="hasDuplicateProviderType" class="group-description warning-text">
        Multiple enabled providers share the same type. The bridge currently uses the first enabled
        provider for that type.
      </p>

      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="napcat.requireMention"
          @change="updateNapCat('requireMention', ($event.target as HTMLInputElement).checked)"
        />
        Require @mention in group chats before replying
      </label>

      <label class="input-label">
        <span>Allowed Tools (one per line)</span>
        <textarea
          :value="toolListText"
          rows="4"
          placeholder="web&#10;fetch"
          @input="updateTools(($event.target as HTMLTextAreaElement).value)"
        />
        <small class="input-help">Leave empty to disable tool use for QQ replies.</small>
      </label>
    </div>

    <div class="settings-card">
      <div class="card-header">
        <div>
          <div class="card-title">Connection Summary</div>
          <div class="card-subtitle">What NapCat needs to connect successfully</div>
        </div>
      </div>

      <div class="summary-list">
        <div class="summary-row">
          <span class="summary-label">Status</span>
          <span class="status-chip" :class="{ active: napcat.enabled }">
            {{ napcat.enabled ? 'Enabled' : 'Disabled' }}
          </span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Endpoint</span>
          <code>ws://127.0.0.1:6127/onebot/v11/ws</code>
        </div>
        <div class="summary-row">
          <span class="summary-label">Authentication</span>
          <span>{{ napcat.accessToken.trim() ? 'Bearer token required' : 'No token required' }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Provider</span>
          <span>{{ providerSummary }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Tools</span>
          <span>{{ toolSummary }}</span>
        </div>
      </div>
    </div>

    <div class="config-actions">
      <button class="reset-btn" type="button" @click="emit('reset')">Reset Bridges</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';

import { useConfigStore } from '../../store/config';
import type { AppConfig } from '../../../shared/types/config';
import type { Provider } from '../../../shared/types/provider';
import { parseModelList } from '../../../shared/utils/provider_models';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
}>();
const props = defineProps<{
  active: boolean;
}>();

type ProviderOption = {
  type: string;
  label: string;
  models: string[];
  duplicateCount: number;
};

const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const providers = ref<Provider[]>([]);
const providersLoading = ref(false);
const providersError = ref('');

const napcat = computed(() => config.value.bridges.napcat);

const providerOptions = computed<ProviderOption[]>(() => {
  const byType = new Map<string, ProviderOption>();

  for (const provider of providers.value) {
    if (!provider.enabled) continue;
    const type = provider.type?.trim();
    if (!type) continue;

    const models = parseModelList(provider.models);
    if (models.length === 0) continue;

    const existing = byType.get(type);
    if (existing) {
      existing.duplicateCount += 1;
      continue;
    }

    byType.set(type, {
      type,
      label: `${provider.name} (${type})`,
      models,
      duplicateCount: 1,
    });
  }

  return Array.from(byType.values()).sort((a, b) => a.label.localeCompare(b.label));
});

const selectedProviderOption = computed(() => {
  const providerType = napcat.value.providerType?.trim();
  if (!providerType) return null;
  return providerOptions.value.find(option => option.type === providerType) || null;
});

const selectedProviderModels = computed(() => selectedProviderOption.value?.models || []);

const hasDuplicateProviderType = computed(() =>
  providerOptions.value.some(option => option.duplicateCount > 1)
);

const toolListText = computed(() => napcat.value.tools.join('\n'));

const providerSummary = computed(() => {
  const providerType = napcat.value.providerType?.trim();
  const model = napcat.value.model?.trim();

  if (!providerType && !model) return 'Auto-select first enabled provider and model';
  if (providerType && model) return `${providerType} / ${model}`;
  if (providerType) return `${providerType} / default model`;
  return `Auto-select provider / ${model}`;
});

const toolSummary = computed(() => {
  return napcat.value.tools.length > 0 ? napcat.value.tools.join(', ') : 'Disabled';
});

const updateNapCat = <K extends keyof AppConfig['bridges']['napcat']>(
  key: K,
  value: AppConfig['bridges']['napcat'][K]
) => {
  config.value.bridges.napcat[key] = value;
  emit('config-change');
};

const updateTools = (value: string) => {
  const tools = value
    .split(/[\r\n,]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index);
  updateNapCat('tools', tools);
};

const loadProviders = async () => {
  providersLoading.value = true;
  providersError.value = '';
  try {
    if (!window?.electronAPI?.providers?.list) {
      providers.value = [];
      providersError.value = 'Provider API is unavailable.';
      return;
    }
    const list = await window.electronAPI.providers.list();
    providers.value = Array.isArray(list) ? (list as Provider[]) : [];
  } catch (error: any) {
    providers.value = [];
    providersError.value = error?.message || 'Failed to load providers.';
  } finally {
    providersLoading.value = false;
  }
};

watch(
  () => props.active,
  active => {
    if (active) {
      void loadProviders();
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.bridges-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.config-group,
.settings-card {
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: 16px;
  background: var(--color-surface, rgba(255, 255, 255, 0.03));
  padding: 20px;
}

.config-inline {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}

.input-label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.input-label input,
.input-label select,
.input-label textarea {
  width: 100%;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  border-radius: 12px;
  background: var(--color-input, rgba(0, 0, 0, 0.18));
  color: inherit;
  padding: 10px 12px;
  font: inherit;
}

.input-label textarea {
  resize: vertical;
}

.input-help,
.group-description,
.card-subtitle {
  color: var(--color-text-muted, rgba(255, 255, 255, 0.64));
}

.warning-text,
.error-text {
  margin-top: 12px;
}

.warning-text {
  color: #d18a32;
}

.error-text {
  color: #cc5a5a;
}

.card-header {
  margin-bottom: 14px;
}

.card-title {
  font-weight: 600;
}

.summary-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.summary-label {
  color: var(--color-text-muted, rgba(255, 255, 255, 0.64));
}

.status-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  background: rgba(204, 90, 90, 0.18);
  color: #cc5a5a;
}

.status-chip.active {
  background: rgba(70, 150, 90, 0.18);
  color: #57b56f;
}

.config-actions {
  display: flex;
  justify-content: flex-end;
}

.reset-btn {
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  border-radius: 999px;
  background: transparent;
  color: inherit;
  padding: 10px 16px;
  cursor: pointer;
}
</style>
