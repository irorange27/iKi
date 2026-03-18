# Core Emotion

## Purpose
Provide emotion analysis for user messages and aggregate affect state for tone guidance.

## Responsibilities
- Parse and normalize emotion payloads.
- Store emotion events without message content.
- Aggregate recent events into an affect state with decay and thresholds.

## Key Files
- `src/core/provider/emotion_model.ts`: LLM-driven emotion extraction.
- `src/core/emotion/affect_state.ts`: aggregation, weighting, and affect system prompt.
- `src/core/db/emotion.ts`: emotion event storage.
- `src/main/services/chat/chat_memory.ts`: integration into the prompt flow.

## Data Flow
1. User message is persisted.
2. Emotion analysis runs asynchronously.
3. Emotion events are stored per thread.
4. Affect state is computed and injected into system prompt (configurable).

## Invariants
- Incognito threads skip emotion analysis and injection.
- Emotion injection is gated by `memory.emotion` config.
- Aggregation requires minimum sample count and confidence.

## Extension Points
- Customize emotion labels or parsing in `emotion_model.ts`.
- Tune decay and windowing parameters in config.
- Add UI display of affect state.

## Failure Modes
- Malformed JSON from the tool model yields no emotion update.
- No recent samples leads to no affect injection.

## Testing
- `tests/core/emotion/affect_state.test.ts`
