# Skaro 2.2.7

## Changes

- A merge blocked by local edits can use the existing resolve-with-agent action.
  Automatic merging enters the same saved operation without a blocked merge card.
- Skaro preserves the original files and index, resolves accepted task results,
  staged edits and working-file edits in an isolated checkout, then continues
  publication automatically. Local edits remain staged/unstaged rather than
  becoming part of the task commit.
- Saved operations survive restart. A changed base or new local edits creates
  a fresh candidate while retaining the owner's publication authorization.
- Merge cards also appear in a task conversation that has no messages yet.

## Verification

Production build, desktop TypeScript, renderer checks, changed-file lint and
formatting passed. Targeted tests cover all three merge strategies, separate
local layers, restart, changed inputs, failed publication recovery, binary and
ignored files, directory changes and entry from automatic merging.

The real Electron application and installed Codex agent completed the entire
button-to-publication scenario. Git checks confirmed a clean task commit,
preserved staged and unstaged local behavior and a completed task. Screenshots
were inspected; no substitute backend or mocked agent was used.

On 23 October 2026 the owner explicitly authorized the existing full release
suite with isolated fixtures and HTTP test servers. The owner also authorized
reuse of the successful Codex/Claude canary and model checks recorded for 2.2.6.
Agent, SDK and adapter pins are unchanged. This confirms `test_fixtures_allowed`
and `agents_verified`; it does not claim fresh canary runs for both agents.
Full CI checks remain a gate before publication.

## Distribution

Both the bundle and displayed application version are 2.2.7. The standard
workflow publishes six native installers and the separate seven-file update
feed from main. Release notes retain the Windows/macOS/Linux by x64/arm64
download table. The existing signing policy is unchanged.
