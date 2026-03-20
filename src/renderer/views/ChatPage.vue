<template>

</template>

<script lang="ts">
import { useChat } from '../composables/useChat';
import { ref } from 'vue';

export default {
    setup() {
        const chat = useChat({});
        const messages = ref<unknown[]>([]);
        return {
            chat,
            messages
        };
    }
}

</script>
