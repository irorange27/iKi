

export const REQUEST_SYSTEM_PROMPT_SLOTS = {

  persona: 100,

  planPrompt: 200,

  extraPrompt: 300,

  transcriptSystem: 400,
} as const;

export type RequestSystemPromptSlot = keyof typeof REQUEST_SYSTEM_PROMPT_SLOTS;

export type RequestSystemPromptPart = {
  slot: RequestSystemPromptSlot;
  text: string;
};

export type AssembledRequestSystemPrompt = {

  slots: RequestSystemPromptPart[];

  prompt: string;
};

export const assembleRequestSystemPrompt = (
  parts: readonly RequestSystemPromptPart[]
): AssembledRequestSystemPrompt => {
  const slots = parts
    .filter(part => part.text.trim().length > 0)
    .sort(
      (a, b) => REQUEST_SYSTEM_PROMPT_SLOTS[a.slot] - REQUEST_SYSTEM_PROMPT_SLOTS[b.slot]
    );
  return { slots, prompt: slots.map(part => part.text).join('\n\n') };
};

export const assembleAuxRequestSystemPrompt = (params: {

  instruction: string;

  details?: readonly string[];
}): AssembledRequestSystemPrompt => {
  const text = [params.instruction, ...(params.details ?? [])].join('\n\n');
  return assembleRequestSystemPrompt([{ slot: 'extraPrompt', text }]);
};
