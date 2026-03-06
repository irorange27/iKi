import { Chat } from "@ai-sdk/vue";

export function useChat(...args: ConstructorParameters<typeof Chat>) {
    const chat = new Chat(...args);
    return chat;
}
