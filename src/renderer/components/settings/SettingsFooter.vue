<template>
  <div class="settings-footer">
    <span v-if="saved" class="save-status">All changes saved</span>
    <div class="footer-actions">
      <button class="secondary" @click="$emit('close')">Close</button>
      <button class="primary" @click="$emit('save')">Save</button>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  saved: Boolean,
});
const emit = defineEmits(['close', 'save']);
</script>
