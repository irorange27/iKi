# Emotion System Integration

## Context
The emotion pipeline previously analyzed user messages and stored the result in short-term memory,
but it never influenced agent behavior. This created a gap between the documented "emotional
system" and actual decision-making.

## Goals
- Integrate affect signals into the agent decision loop in a deterministic, auditable way.
- Keep the signal soft: it should adjust tone and pacing without overriding user intent.
- Respect privacy: store emotion metadata without message content when memory is off.
- Provide configuration and guardrails to avoid unstable or noisy emotion use.

## Non-Goals
- Psychiatric inference or clinical interpretation.
- Always-on real-time emotion analysis for every response (it's optional and adds latency).
- Opaque, non-configurable safety blocking. All guardrails remain explicit and user controlled.

## Architecture
### Data Flow
1. Message persisted.
2. Emotion analysis runs asynchronously on user messages.
3. Emotion events are stored without message content.
4. When generating a response, the latest emotion events are aggregated into an affect state.
5. A short system message injects the affect signal for tone guidance.

### Storage
New table: `emotion_events`
- `thread_id`, `message_id`, `role`
- `emotion` JSON payload
- timestamps

New table: `affect_states`
- `thread_id` (primary key)
- `state` JSON payload (latest computed affect state)
- timestamps

Short-term memory is updated with emotion metadata only when memory storage is enabled. This
keeps the UI's memory viewer intact without forcing content storage when memory is off.

### Aggregation
Affect state is computed from recent emotion events:
- Filter by `maxAgeMinutes`.
- Take up to `windowSize` most recent samples.
- Optionally exclude neutral labels.
- Weight by confidence and exponential time decay (`halfLifeMinutes`).
- Require `minSampleCount` and `minConfidence`.

If no emotion events are available yet, the system can fall back to short-term memory entries (when
memory storage is enabled) to avoid a cold start after upgrade.

### Prompt Injection
The injected system message contains a concise affect snapshot plus guardrails:
- Primary label, confidence, optional valence/arousal, and top label distribution.
- Instruction to only adjust tone/pacing and add brief confirmations when needed.
- Explicit reminder to never override user instructions or mention the analysis unprompted.

### Real-time Analysis (Optional)
When `realtimeAnalysis` is enabled, the current user message is analyzed before generating the
response. The resulting affect sample is merged with recent events and injected into the system
prompt for this reply. This adds one extra tool-model call and latency. The analysis is cached so
the later persistence pass can reuse it.

### Tool Guardrails
When enabled, tool autonomy is reduced under high-arousal, negative-valence states:
- Auto tools can be suppressed.
- All tool calls can require user approval.
- Guarding requires explicit arousal/valence outputs; no label heuristics are used.

### UI Transparency
The Memory Viewer surfaces the latest affect state (label, confidence, valence/arousal, window)
per thread, pulled from the persisted `affect_states` table.

## Configuration
`memory.emotion` settings (defaults in parentheses):
- `enabled` (false): master switch for emotion analysis.
- `injectToSystemPrompt` (true): include affect state in the system context.
- `realtimeAnalysis` (false): analyze the current message before responding.
- `minConfidence` (0.45): minimum aggregated confidence to inject.
- `minSampleCount` (2): minimum number of valid samples.
- `windowSize` (8): number of recent samples considered.
- `halfLifeMinutes` (60): decay half-life for older samples.
- `maxAgeMinutes` (180): max age for usable samples.
- `includeNeutral` (false): whether neutral signals should count.
- `toolGuard.enabled` (true): enable affect-based tool guardrails.
- `toolGuard.minConfidence` (0.6): minimum confidence to guard.
- `toolGuard.minArousal` (0.6): minimum arousal to guard.
- `toolGuard.maxValence` (-0.2): maximum (negative) valence to guard.
- `toolGuard.requireApproval` (true): require approvals for tool calls when guarded.
- `toolGuard.disableAutoTools` (false): suppress auto tools when guarded.

## Privacy and Incognito
- Emotion events are stored without message content.
- Incognito threads skip emotion analysis and affect injection entirely.
- When memory storage is disabled, emotion signals do not create memory_short content entries.

## Limitations
- Persisted affect state lags by one message because analysis is asynchronous. With real-time
  analysis enabled, the current response can still incorporate the latest signal, but storage
  updates after persistence.
- Tool guardrails require valence/arousal to be present; missing signals will bypass guarding.
- Existing historical memory entries are not backfilled into emotion events.

## Testing
Unit tests cover payload parsing, aggregation weighting, neutral filtering, message generation,
and tool guard thresholds.

## Future Work
- Per-thread affect history/timeline for audit and debugging workflows.
- Adaptive real-time analysis gating based on latency budgets and model availability.
- Calibrated guardrail presets based on observed false positives/negatives.
