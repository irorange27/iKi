<template>

</template>

<script lang="ts">
import { useChat } from '../composables/useChat';
import { ref } from 'vue';
import { UIMessage } from 'ai';
import { MessageConversionError } from 'ai';

export default {
    setup() {
        const chat = useChat({});
        const messages = ref([]);
        return {
            chat,
            messages
        };
    }
}

</script>