## Summary

- What changed?
- Why now?

## Verification

- [ ] `pnpm run ci:quality` (`eslint`, `tsc`, `vue-tsc`, `depcruise`, `knip`)
- [ ] `pnpm exec vitest run packages/*/tests`
- [ ] `pnpm run test:e2e:cli:faux` (for CLI / harness / tool changes)

## Checklist

- [ ] PR title follows Conventional Commits (e.g. `feat(tools): ...`, `fix(cli): ...`)
- [ ] Relevant package `README.md` / `AGENTS.md` updated if boundaries or behavior changed
- [ ] If `changelogs/` changed, it was generated via `pnpm run changelog:sync` rather than edited by hand
