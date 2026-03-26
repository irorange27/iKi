<template>
  <div class="preview-column">
    <div class="preview-title">{{ t('settings.theme.preview.title') }}</div>
    <div class="preview-shell" :style="previewStyle">
      <div class="preview-window-bar">
        <div class="preview-dots">
          <span class="preview-dot dot-red" />
          <span class="preview-dot dot-yellow" />
          <span class="preview-dot dot-green" />
        </div>
        <div class="preview-window-name">{{ label || t('settings.theme.preview.untitled') }}</div>
      </div>
      <div class="preview-body">
        <div class="preview-sidebar">
          <div class="preview-sidebar-item active">{{ t('settings.theme.preview.selectedItem') }}</div>
          <div class="preview-sidebar-item">{{ t('settings.theme.preview.menuItem1') }}</div>
          <div class="preview-sidebar-item">{{ t('settings.theme.preview.menuItem2') }}</div>
        </div>
        <div class="preview-main">
          <div class="preview-card">
            <div class="preview-card-title">{{ t('settings.theme.preview.cardTitle') }}</div>
            <div class="preview-card-copy">{{ t('settings.theme.preview.cardCopy') }}</div>
          </div>
          <div class="preview-actions">
            <button class="preview-primary-btn" type="button">
              {{ t('settings.theme.preview.primary') }}
            </button>
            <button class="preview-secondary-btn" type="button">
              {{ t('settings.theme.preview.secondary') }}
            </button>
            <button class="preview-tertiary-btn" type="button">
              {{ t('settings.theme.preview.delete') }}
            </button>
          </div>
          <div class="preview-code">
            <span class="code-keyword">const</span>
            <span class="code-variable">message</span>
            <span class="code-operator">=</span>
            <span class="code-string">"Hello"</span>
            <span class="code-punctuation">;</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../i18n';

defineProps<{
  label: string;
  previewStyle: Record<string, string>;
}>();
const { t } = useI18n();
</script>

<style scoped>
.preview-column {
  position: sticky;
  top: 4px;
  width: 100%;
  min-width: 360px;
  max-width: 500px;
  align-self: start;
  justify-self: end;
}

.preview-title {
  font-size: 1.05em;
  font-weight: 700;
  margin-bottom: 12px;
}

.preview-shell {
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  border-radius: 26px;
  overflow: hidden;
  background: var(--bg-secondary);
  color: var(--text-primary);
  box-shadow: var(--surface-shadow-lg);
}

.preview-window-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 90%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 95%, transparent);
}

.preview-dots {
  display: flex;
  gap: 8px;
}

.preview-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
}

.dot-red {
  background: var(--danger-color);
}

.dot-yellow {
  background: var(--warning-color);
}

.dot-green {
  background: var(--success-color);
}

.preview-window-name {
  font-size: 1.15em;
  font-weight: 700;
}

.preview-body {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  min-height: 332px;
}

.preview-sidebar {
  border-right: 1px solid color-mix(in srgb, var(--border-color) 90%, transparent);
  padding: 14px 12px;
  background: color-mix(in srgb, var(--bg-primary) 90%, transparent);
}

.preview-sidebar-item {
  color: var(--text-primary);
  padding: 10px 12px;
  border-radius: 12px;
  margin-bottom: 8px;
  font-size: 0.98em;
}

.preview-sidebar-item.active {
  background: color-mix(in srgb, var(--accent-color) 16%, var(--bg-hover));
  font-weight: 600;
}

.preview-main {
  padding: 18px 18px 20px;
  background: color-mix(in srgb, var(--bg-secondary) 94%, transparent);
}

.preview-card {
  padding: 18px 20px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--bg-tertiary) 94%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 90%, transparent);
  margin-bottom: 18px;
}

.preview-card-title {
  font-size: 1.45em;
  font-weight: 700;
  margin-bottom: 8px;
}

.preview-card-copy {
  color: var(--text-secondary);
  font-size: 1.02em;
}

.preview-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.preview-primary-btn,
.preview-secondary-btn,
.preview-tertiary-btn {
  border: none;
  border-radius: 12px;
  padding: 10px 16px;
  font-size: 0.98em;
  cursor: default;
}

.preview-primary-btn {
  background: color-mix(in srgb, var(--accent-color) 84%, white 16%);
  color: var(--accent-contrast);
}

.preview-secondary-btn {
  background: color-mix(in srgb, var(--bg-primary) 78%, transparent);
  color: var(--text-primary);
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
}

.preview-tertiary-btn {
  background: color-mix(in srgb, var(--accent-color) 48%, var(--success-color) 52%);
  color: color-mix(in srgb, var(--text-primary) 88%, var(--bg-primary));
}

.preview-code {
  padding: 16px 18px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-primary) 84%, transparent);
  color: var(--text-primary);
  font-family: 'SF Mono', 'JetBrains Mono', 'Cascadia Code', Consolas, 'Liberation Mono', monospace;
  font-size: 0.95em;
}

.code-keyword {
  color: color-mix(in srgb, var(--success-color) 84%, white 16%);
}

.code-variable {
  color: color-mix(in srgb, var(--accent-color) 82%, white 18%);
  margin-left: 8px;
}

.code-operator {
  color: var(--text-secondary);
  margin: 0 8px;
}

.code-string {
  color: color-mix(in srgb, var(--warning-color) 74%, white 26%);
}

.code-punctuation {
  color: var(--text-secondary);
}

@media (max-width: 1120px) {
  .preview-column {
    min-width: 320px;
    max-width: 420px;
  }
}

@media (max-width: 860px) {
  .preview-column {
    position: static;
    min-width: 0;
    max-width: none;
    justify-self: stretch;
  }
}

@media (max-width: 780px) {
  .preview-body {
    grid-template-columns: 1fr;
  }
}
</style>
