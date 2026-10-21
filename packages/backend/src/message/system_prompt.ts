/**
 * The single owner of request system prompt assembly: which named slots one
 * model request's system prompt consists of, in what order, and how they
 * join. Pattern reference: DeepSeek Harness's dedicated registry package
 * (`@deepseek-ai/dsh-system-prompt`) — named contributions, centrally owned
 * placement, and an assemble/render split so the assembled parts stay
 * attributable for budget estimates, tests and diagnostics.
 *
 * Content stays with its owners; this module owns ONLY the assembly
 * contract:
 * - `persona` — the persona text (identity, date/timezone, OS, cwd),
 *   owned by `src/persona.ts` and fetched by callers through the factory's
 *   `resolvePersonaPrompt`;
 * - `planPrompt` — the execution plan's system prompt (mode prompt +
 *   personality style, the latter owned by `message/personality.ts`),
 *   assembled by `thread_session/execution_plan.ts`;
 * - `extraPrompt` — a per-call extra prompt (aux/single-shot callers, and
 *   the no-tools turn's mode prompt added by the factory);
 * - `transcriptSystem` — system message(s) carried in the prepared history.
 *   The Pi adapter folds the first into the system prompt and replays the
 *   rest as Pi system messages.
 *
 * Every model request in the repo builds its system prompt through
 * `assembleRequestSystemPrompt`, including aux calls (through
 * `assembleAuxRequestSystemPrompt`, which DECLARES the auxiliary slot instead
 * of letting a caller pass a bare string through). A new part claims a slot
 * in the table — no caller ever joins prompt strings by hand, and no caller
 * bypasses the table with a pre-joined override.
 */

/** Centrally owned placement (ascending). Slot names are the stable
 * vocabulary for tests, estimates and review. */
export const REQUEST_SYSTEM_PROMPT_SLOTS = {
  /** Who/where/when — precedes everything (the harness identity slot in dsh). */
  persona: 100,
  /** The execution plan's mode prompt + personality. */
  planPrompt: 200,
  /** A per-call extra prompt (aux calls, single-shot generation). */
  extraPrompt: 300,
  /** System message(s) carried in the prepared history. */
  transcriptSystem: 400,
} as const;

export type RequestSystemPromptSlot = keyof typeof REQUEST_SYSTEM_PROMPT_SLOTS;

/** One contributed part. `text` is passed through byte-for-byte: selection
 * trims to TEST emptiness but never rewrites the rendered bytes — the wire
 * must not change because a caller capitalized differently. */
export type RequestSystemPromptPart = {
  slot: RequestSystemPromptSlot;
  text: string;
};

export type AssembledRequestSystemPrompt = {
  /** The ordered, non-empty parts with their slot names — the attributable
   * form for budget estimation and tests. */
  slots: RequestSystemPromptPart[];
  /** The rendered system prompt: non-empty parts, ascending slot order,
   * within-slot input order preserved (stable sort), blank-line join. */
  prompt: string;
};

/** Assemble one request's system prompt from its named parts. */
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

/**
 * Contributed parts of an AUXILIARY (single-shot) request — summarizer, title,
 * catalog selection, tool router.
 *
 * Aux callers legitimately need a system prompt that is NOT the chat request's
 * persona-led assembly: their whole prompt is runtime-owned content and a
 * chat persona would only dilute it. What they must not do is hand the supply
 * layer a bare string and skip the slot table: that made the same string a
 * `planPrompt` in one assembler and an `extraPrompt` in another, so per-slot
 * budgets, attribution and diagnostics were meaningless for aux traffic.
 *
 * So the slot is declared here — by the slot owner — and the auxiliary
 * semantics live in this one function instead of at every call site.
 */
export const assembleAuxRequestSystemPrompt = (params: {
  /** The runtime's own instruction text (owner: the runtime that wrote it). */
  instruction: string;
  /** Extra context lines the runtime wants appended in the same slot. */
  details?: readonly string[];
}): AssembledRequestSystemPrompt => {
  const text = [params.instruction, ...(params.details ?? [])].join('\n\n');
  return assembleRequestSystemPrompt([{ slot: 'extraPrompt', text }]);
};
