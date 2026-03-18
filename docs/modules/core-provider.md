# Core Provider

## Purpose
Centralize provider configuration, model selection, and auxiliary LLM usage for
tool selection, skill routing, title generation, and emotion analysis.

## Responsibilities
- Resolve enabled provider configs from SQLite.
- Instantiate AI SDK clients (OpenAI, DeepSeek, OpenAI-compatible).
- Fetch and cache model lists from models.dev.
- Provide helper flows for tool model selection, skill/tool routing, and emotion analysis.

## Key Files
- `src/core/provider/llm/factory.ts`: provider config resolution and model creation.
- `src/core/provider/llm/openai.ts`: OpenAI model list cache and helpers.
- `src/core/provider/llm/deepseek.ts`: DeepSeek model list cache and helpers.
- `src/core/provider/llm/kimi.ts`: Kimi model list cache and helpers.
- `src/core/provider/tool_model.ts`: tool model selection and title generation.
- `src/core/provider/tool_selection.ts`: auto tool routing via tool model.
- `src/core/provider/skill_selection.ts`: auto skill routing via tool model.
- `src/core/provider/emotion_model.ts`: emotion analysis via tool model.

## Data Flow
1. Provider config loaded from DB and validated for enabled status.
2. Model selection resolves user preference or recommended defaults.
3. Auxiliary tasks (routing, titles, emotion) run through SimpleAgent with low-cost models.

## Invariants
- Provider must be enabled and have an API key.
- Tool model selection prefers fast, non-reasoning models.
- Tool/skill routing outputs must map to known catalog items.

## Extension Points
- Add provider adapters in `llm/`.
- Adjust recommended model list in `tool_model.ts`.
- Override routing prompt or parsing logic for tool/skill selection.

## Failure Modes
- Missing provider config yields explicit errors.
- Model list fetch failures fall back to stored provider models.
- Tool/skill routing returns empty selections when parsing fails.

## Testing
- `tests/core/provider/tool_selection.test.ts`
- `tests/core/provider/skill_selection.test.ts`
