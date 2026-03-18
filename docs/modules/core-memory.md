# Core Memory

## Purpose
Provide short-term and long-term memory storage, summarization, and retrieval to
augment chat context without leaking sensitive data across threads.

## Responsibilities
- Store short-term memory entries from chat messages.
- Generate long-term summaries via tool model (opt-in).
- Search long-term memory using deterministic hashed embeddings.
- Enforce memory feature flags and incognito rules.

## Key Files
- `src/core/db/memory.ts`: memory tables and retrieval logic.
- `src/core/memory/auto_summarize.ts`: summary generation and sanitization.
- `src/main/services/chat/chat_memory.ts`: injection into prompts and persistence hooks.

## Data Flow
1. Chat messages are persisted and parsed into short memory entries.
2. When auto-summarize is enabled, short memory is summarized into long memory.
3. On each user prompt, long memory search runs and injects context as system messages.

## Invariants
- Memory operations are gated by `memory.enabled` or `memory.autoSummarize`.
- Incognito threads skip memory storage and retrieval.
- Long memory embeddings are deterministic and local (hash-based).

## Extension Points
- Replace embedding strategy in `memory.ts`.
- Adjust summarization prompt or thresholds in `auto_summarize.ts`.
- Modify retrieval ranking logic or thresholds.

## Failure Modes
- Invalid message JSON yields no memory updates (safe fallback).
- Low signal or short transcripts return no summary.

## Testing
- `tests/core/memory/memory_db_crud.test.ts`
- `tests/core/memory/auto_summarize.test.ts`
