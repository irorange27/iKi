import type { ModelMessage } from '@iki/backend/message/model_history';

export const SUMMARY_OPEN_TAG = '<compacted-summary>';
const SUMMARY_CLOSE_TAG = '</compacted-summary>';

// Kept short on purpose: the preamble is paid on every compacted request, and
// the step-budget tests run windows small enough that a 300-character
// instruction is a measurable share of the budget. The meaning is unchanged.
const CHECKPOINT_PREAMBLE =
  '[compacted checkpoint] Treat as established background; build on it without restating it, and continue from the messages below.';

export const COMPACTION_INSTRUCTION = [
  'You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  '## Primary Request and Intent',
  "- [the user's original and evolving goals; quote verbatim where the exact wording matters]",
  '',
  '## Key Technical Concepts',
  '- [technologies, frameworks, patterns, and conventions in play]',
  '',
  '## Files and Code',
  '- [exact path: why it matters, key changes or snippets]',
  '',
  '## Errors and Fixes',
  '- [error: how it was resolved, plus any related user feedback]',
  '',
  '## Pending Jobs',
  '- [explicitly requested work not yet completed]',
  '',
  '## Current Work',
  '- [precisely what was in progress at this checkpoint]',
  '',
  '## Next Step',
  '- [the single next action, directly in line with the most recent request, or "(none)"]',
  '',
  '## Critical Context',
  '- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]',
  '',
  'Rules:',
  '- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.',
  '- Capture user feedback and explicit instructions faithfully, especially corrections.',
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Output only the checkpoint text: do not call any tool or take any other action.',
  `- If the conversation already contains a ${SUMMARY_OPEN_TAG} block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.`,
].join('\n');

export const frameCheckpoint = (summary: string): string =>
  `${CHECKPOINT_PREAMBLE}\n\n${SUMMARY_OPEN_TAG}\n${summary.trim()}\n${SUMMARY_CLOSE_TAG}`;

/**
 * Recover the bare summary from a framed checkpoint so a later compaction can
 * merge it as a prior checkpoint instead of nesting one frame inside another.
 */
export const unwrapCheckpoint = (text: string): string => {
  const start = text.indexOf(SUMMARY_OPEN_TAG);
  const end = text.lastIndexOf(SUMMARY_CLOSE_TAG);
  if (start === -1 || end === -1 || end <= start) return text;
  return text.slice(start + SUMMARY_OPEN_TAG.length, end).trim();
};

export const appendCompactionInstruction = (messages: ModelMessage[]): ModelMessage[] => [
  ...messages,
  { role: 'user', content: [{ type: 'text', text: COMPACTION_INSTRUCTION }] },
];
