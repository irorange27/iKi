# Workflow Self-Optimization

## Context
Auto skill routing already exists, but iKi does not learn from prior runs. Auto tool
mode enables a fixed safe allowlist, which can be more permissive than necessary for
the next response. Users that repeatedly ask similar things end up re-triggering the
same workflow logic each time.

## Goals
- Learn stable, per-thread skill needs and keep them pinned in auto mode.
- Select a minimal safe toolset per message when tool mode is auto.
- Keep manual tool/skill selection fully authoritative.
- Avoid any automatic enablement of high-risk tools.

## Non-goals
- No automatic rewriting of the global system prompt.
- No automatic provider/model switching for user chats.
- No auto-creation or mutation of skills without user review.

## Design
### Data model
New table: `workflow_profiles`
- `thread_id` (PK, FK to `chat_threads`)
- `profile` (JSON)
- `created_at`, `updated_at`

Profile schema (v1):
```json
{
  "version": 1,
  "stats": { "autoSkillRuns": 0 },
  "skills": {
    "skill-id": { "selections": 3, "lastSelectedAt": "2026-03-18T12:00:00Z" }
  },
  "pinnedSkills": ["skill-id"]
}
```

### Skill auto-pinning
Each auto-mode request updates the per-thread skill profile.
- `autoSkillRuns` increments per auto selection attempt.
- `skills[skillId].selections` increments when auto selection chooses the skill.
- A Beta-Binomial estimate derives confidence:
  - `confidence = (selections + 1) / (autoSkillRuns + 2)`
- Pin when all are true:
  - `autoSkillRuns >= minAutoSkillRuns`
  - `selections >= minSkillSelections`
  - `confidence >= pinConfidence`
- Unpin when:
  - `autoSkillRuns >= minAutoSkillRuns`
  - `confidence < unpinConfidence`
- Results are capped by `maxPinnedSkills` and ranked by confidence, selections, and recency.

In auto skill mode, the system prompt includes:
```
manual pinned + auto pinned + per-message auto selection
```
Manual skill mode ignores auto pinned skills.

### Tool routing (auto mode)
Auto tool mode runs a lightweight tool router on the safe allowlist (web + fetch).
The router returns the minimal toolset for the next response, or `[]` if none are needed.
If the tool model is unavailable, auto mode falls back to the default allowlist.

## Configuration
`AppConfig.workflowOptimization`:
- `enabled`
- `autoPinSkills`
- `minAutoSkillRuns`
- `minSkillSelections`
- `pinConfidence`
- `unpinConfidence`
- `maxPinnedSkills`

## Guardrails
- Manual mode always wins.
- Auto tool routing never expands beyond the safe allowlist.
- Reset control clears all auto-pinned state.

## Future Work
- Incorporate explicit user feedback as a stronger optimization signal.
- Add tool usage scoring to shrink auto toolsets further.
- Explore per-thread model preferences once safety and UX are validated.
