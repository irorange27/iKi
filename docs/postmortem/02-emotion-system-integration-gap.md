# Postmortem: Emotion System Integration Gap

## Summary
The emotion analysis pipeline existed but only stored metadata in memory entries. It was never
used in the agent decision loop, creating a mismatch between system description and behavior.

## Impact
- Responses did not adapt tone or pacing to user affect.
- "Emotional system" documentation lacked a real behavioral effect, reducing trust in system
  claims.

## Root Cause
Emotion analysis was implemented as a memory attribute without a designed path into the agent
prompt or tool strategy. There were no configuration controls or tests covering integration.

## Detection
User feedback highlighted that emotion signals were not influencing responses. Code review
confirmed no injection into the system prompt or tool selection.

## Resolution
- Added an `emotion_events` table to store emotion metadata without message content.
- Introduced affect aggregation with decay, thresholds, and minimum samples.
- Injected an affect snapshot into the system prompt with guardrails.
- Added an optional real-time analysis path with caching to avoid duplicate calls.
- Persisted per-thread affect state for UI transparency.
- Added affect-based tool guardrails (approval escalation and optional auto-tool suppression).
- Added configuration controls, tests, and design documentation.

## Preventive Actions
- Add a review checklist item: "signal-to-decision integration" for new subsystems.
- Require design docs and tests for any behavior-shaping feature.
- Add a lightweight integration test to ensure emotion context can reach the prompt path.

## Follow-ups
- Consider adding per-thread affect history for audits.
- Monitor latency impact of real-time analysis and consider adaptive gating.
