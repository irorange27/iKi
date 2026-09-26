# Trajectory dogfood: missing and misleading failure feedback

Observed 2026-09-26; verification continued 2026-09-27. The reference UI was inspected before implementation. These issues were reproduced with the actual Electron renderer, isolated test data and a local scripted provider.

## Failed sends restored the draft but lost the error

An OpenAI Responses request to the local Chat Completions-only test endpoint returned HTTP 404 / `Not Found`. The composer restored the original draft but displayed no failure explanation.

`useChatComposerSend` restored `message`, then published the error. Its default asynchronous draft watcher subsequently cleared that newly published feedback. The state updates were individually plausible; their scheduling erased the result the user needed.

The draft watcher now runs synchronously. Draft restoration clears old feedback before the catch path publishes the new error. A regression checks the error after Vue's update queue settles, then verifies that a subsequent user edit clears it. Actual Electron screenshots confirm both the retained draft and visible error. The provider's unsupported endpoint remains an intentional negative test, not a provider bug “fixed” by this patch.

## Failed writes appeared successful in grouped chat output

In a chat without a workspace, the scripted provider requested `write_file`, which was not in the available tool set. Backend audit records correctly recorded the unavailable-tool error. The chat group still said `Wrote`, and the embedded tool renderer hid the header containing the failure explanation.

The group and child verb now depend on the existing shared tool-state classifier. Failure/active states override success-tense verbs; embedded failures have a visible alert. The regression failed with `Wrote` before the fix and passes with `Failed` and the unavailable-tool reason afterwards. No files were written in this negative case. A provider final message and a completed run do not establish that every tool succeeded.

## Verification infrastructure and recovery

The existing smoke script globally killed `electron-forge start`, including unrelated dev instances, when ports were occupied or a test restarted. A separate dev instance was present on continuation, so that behavior was not executed. The gate now fails on occupied ports, accepts explicit port overrides, and terminates only process groups it launched plus Electron helpers belonging to its unique test profile. Early launcher exit is reported immediately instead of waiting for CDP timeout.

During isolated checkout setup, a writable `node_modules` symlink allowed pnpm's implicit installation to affect the main checkout's dependencies. Interrupting that unexpected installation left Electron's runtime missing and some package bin files non-executable. This was an execution mistake in the verification workflow, not an application regression. Recovery used `pnpm install --frozen-lockfile`; the installation and Electron postinstall completed successfully. No lockfile edits were made. The isolated gate was then launched via `npm run test:e2e` (the same package script) to avoid implicit dependency installation through the shared symlink. Future test checkouts must isolate dependency installation as well as source, profile, ports and build output.

## Durable checks

- Assert visible feedback after scheduling has settled, not only that an error setter was called.
- Derive user-visible outcome wording from actual tool state, including embedded/grouped representations.
- Inspect run-level data even when no steps have been appended; queued runs must remain cancellable.
- Keep backend audit timestamps truthful. Equal append timestamps are not measured inference duration.
- Validate real consumer effects: provider payloads, persisted approval decisions, filesystem effects and reconstructed history.
- Test infrastructure owns only resources it created. Name matches and occupied ports do not confer process ownership.

See `docs/reports/trajectory-dogfood-2026-09-26.md` for acceptance evidence and limitations; `packages/desktop/README.md` records the presentation and regression owners.
