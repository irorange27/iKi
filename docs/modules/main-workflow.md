# Main Workflow Optimization

## Purpose
Track auto-selected skills and promote frequently chosen skills to pinned status
per thread.

## Responsibilities
- Track auto skill selections and total runs.
- Compute pin and unpin decisions based on confidence thresholds.
- Persist workflow profiles per thread.

## Key Files
- `src/main/services/workflow/workflow_optimizer.ts`: scoring, pinning, and profile updates.
- `src/core/db/workflow_profile.ts`: workflow profile storage.

## Data Flow
1. Auto skill selection records a run and per-skill selection count.
2. Confidence scores are computed from selection counts.
3. Pinned skills are updated and stored in workflow profile table.

## Invariants
- Workflow optimization is gated by `workflowOptimization.enabled` and `autoPinSkills`.
- Pinned skills are capped by `maxPinnedSkills`.
- Profiles are normalized and versioned.

## Extension Points
- Adjust confidence scoring formula.
- Add additional signals (latency, user feedback).
- Add UI to visualize profile history.

## Failure Modes
- Missing profile falls back to defaults.
- Non-existent skills are filtered out when pinning.

## Testing
- `tests/main/services/workflow/workflow_optimizer.test.ts`
