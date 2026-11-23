/**
 * Ordered system prompt slot & section assembler, plus cache-safe diffing
 * (append changed sections at the tail instead of mutating message #0) and
 * dynamic user-role PromptContext formatting.
 */

export const REQUEST_SYSTEM_PROMPT_SLOTS = {
  persona: 100,
  planPrompt: 200,
  extraPrompt: 300,
  transcriptSystem: 400,
} as const;

export const SYSTEM_PROMPT_SECTION_ORDERS = {
  persona: 100,
  planPrompt: 200,
  extraPrompt: 300,
  project_context: 400,
  skills: 500,
  transcriptSystem: 600,
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

export type PromptSection = {
  name: string;
  order: number;
  text: string;
  tagged?: boolean;
};

export type PromptSectionMap = Record<string, string>;

/** Normalize ordered sections into a stable name -> rendered text map. */
export const renderPromptSections = (sections: readonly PromptSection[]): PromptSectionMap => {
  const ordered = [...sections]
    .filter(section => section.text.trim().length > 0)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const out: PromptSectionMap = {};
  for (const section of ordered) {
    const trimmed = section.text.trim();
    out[section.name] = section.tagged === false ? trimmed : `<${section.name}>\n${trimmed}\n</${section.name}>`;
  }
  return out;
};

export const joinPromptSections = (sections: PromptSectionMap): string =>
  Object.values(sections)
    .filter(text => text.trim().length > 0)
    .join('\n\n');

/**
 * Compare previously admitted sections against the desired ones and return only
 * changed/added/retired entries so callers can append an incremental update
 * without mutating the leading system message (preserving KV cache).
 */
export const diffPromptSections = (
  previous: PromptSectionMap,
  current: PromptSectionMap
): Record<string, string | null> | undefined => {
  const patch: Record<string, string | null> = {};
  for (const [name, text] of Object.entries(current)) {
    if (previous[name] !== text) patch[name] = text;
  }
  for (const name of Object.keys(previous)) {
    if (current[name] === undefined) patch[name] = null;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
};

export type PromptContextEntry = {
  name: string;
  order: number;
  text: string;
};

/**
 * Render dynamic external reminders (PromptContext) as a user-role block to
 * append at the tail only when changed, keeping the system prefix immutable.
 */
export const formatPromptContextSnapshot = (entries: readonly PromptContextEntry[]): string => {
  const active = [...entries]
    .filter(entry => entry.text.trim().length > 0)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  if (active.length === 0) return '';
  return active
    .map(entry => `<system_reminder name="${entry.name}">\n${entry.text.trim()}\n</system_reminder>`)
    .join('\n\n');
};
