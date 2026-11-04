/**
 * The slots a request's system prompt can be built from, and the order they are
 * joined in. Ordering is the point: a persona sits above the task instructions,
 * which sit above whatever the transcript carried.
 */
export const REQUEST_SYSTEM_PROMPT_SLOTS = {
  persona: 100,
  planPrompt: 200,
  extraPrompt: 300,
  transcriptSystem: 400,
} as const;

type RequestSystemPromptSlot = keyof typeof REQUEST_SYSTEM_PROMPT_SLOTS;

export type RequestSystemPromptPart = {
  slot: RequestSystemPromptSlot;
  text: string;
};

/** The request's system prompt, or an empty string when there is nothing to send. */
export const assembleRequestSystemPrompt = (
  parts: readonly RequestSystemPromptPart[]
): string =>
  parts
    .filter(part => part.text.trim().length > 0)
    .sort((a, b) => REQUEST_SYSTEM_PROMPT_SLOTS[a.slot] - REQUEST_SYSTEM_PROMPT_SLOTS[b.slot])
    .map(part => part.text)
    .join('\n\n');

export const assembleAuxRequestSystemPrompt = (params: {
  instruction: string;
  details?: readonly string[];
}): string =>
  assembleRequestSystemPrompt([
    { slot: 'extraPrompt', text: [params.instruction, ...(params.details ?? [])].join('\n\n') },
  ]);
