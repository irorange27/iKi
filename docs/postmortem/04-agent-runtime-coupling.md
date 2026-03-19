# Postmortem: Agent Runtime Coupling

## Summary

The original `SimpleAgent` abstraction accumulated both conversation-runner responsibilities and
domain-agent semantics. This worked for chat, but it created the wrong dependency shape for
task-style agents such as emotion analysis, especially once we needed a path to a future external
emotion-recognition backend.

## Impact

- Task-style features were implicitly tied to chat-oriented state and tool-loop semantics.
- Swapping a backend for a domain agent required touching abstractions designed for conversation
  orchestration.
- The name "agent" stayed conceptually clear, but the implementation boundary underneath it was not.

## Root Cause

We conflated three different concerns in one abstraction:

- domain capability
- backend execution strategy
- conversation orchestration

`SimpleAgent` became the default solution for both task and chat scenarios because it was already
available, not because it was the correct semantic fit for both.

## Detection

The coupling became obvious during the review of how `EmotionAgent` should evolve toward a dedicated
external model. Comparison against runner-oriented systems such as AstrBot reinforced that tool
loops and approvals belong to a runner layer, not to every domain agent.

## Resolution

- Introduced `EmotionAgent` as a task-style domain agent.
- Introduced `EmotionRuntime` as a pluggable execution boundary.
- Moved the current LLM-based emotion implementation into `LlmEmotionRuntime`.
- Preserved the old `analyzeEmotionWithAgent(...)` entry point as a compatibility wrapper.
- Added tests and module/design documentation for the new boundary.

## Preventive Actions

- Add an architecture review checklist item: distinguish domain agent, runtime, and conversation
  runner before introducing new abstractions.
- Avoid using `SimpleAgent` for new task-style capabilities by default.
- Prefer compatibility wrappers during boundary changes so behavior can stay stable while concepts
  improve.

## Follow-ups

- Extract title generation and catalog selection into task-style agents with their own runtimes.
- Rename or replace `SimpleAgent` with a conversation-runner-oriented abstraction.
- Revisit the chat approval/message adaptation layer after the task-agent boundary is fully in use.
