# Skaro 2.2.12

## Changes

- A successful model turn no longer ends an authorized task. Skaro continues the
  task through implementation, verification and `submit_result`; with automatic
  merging enabled, the accepted result proceeds to its merge into the base branch.
- Execution intent survives an application restart. Explicit stops, real questions,
  architecture decisions and concrete external blockers suspend continuation.
  Duplicate turn events cannot enqueue duplicate continuations, and repeated turns
  without changes stop instead of consuming the agent's allowance indefinitely.
- Skaro no longer invents an empty reply question when an agent ends a turn.
  Restoring old history retires these legacy cards. Real questions and acceptance
  criteria still apply; automatic execution must resolve unmet criteria itself.
- Architecture package decisions resume existing task runs. Internal continuation
  messages retain delivery evidence without appearing as messages from the owner.
- A task environment can declare existing source services in its main checkout.
  Skaro validates their Compose ownership, starts only those existing containers
  and waits for readiness before the first data copy. It does not create source
  containers or replace their accounts, images, mounts or data.
- Task instructions describe completion and merging per task and direct routine
  environment preparation through the project tools.

## Verification

Production main/preload/renderer builds and the final main build passed. All 32
targeted tests covering execution intent, legacy wait cards, prompts, environment
configuration and source service validation passed. The changed files passed
TypeScript, ESLint, Prettier and the file-size/responsibility review during the fix.

In a real isolated project, signed-in Codex ended its first turn without a result.
Skaro continued it without another owner message, accepted `submit_result` and
merged the README-only change into main at
`43194d628da48f37055ae6ea1542b015f2e6a7c9`. Two native Electron browser checks
passed on the final build, including restored merge history and the absence of
invented questions after real agent turns. Existing source PostgreSQL readiness
was also checked against the real Docker environment, without recreation.

The owner's Chatballs T-171 was resumed but is not claimed as completed or merged
by this release verification. No synthetic API or replacement backend was used.

On 31 October 2026 the owner authorized publication, the standard full release
suite with its existing isolated fixtures and HTTP test servers, and reuse of the
previously accepted checks of unchanged agent pins with the existing Claude
limitation. No new successful Claude canary is claimed. The release workflow runs
the complete checks before packaging all six platforms.

## Distribution

Bundle and displayed application version: 2.2.12. The standard workflow publishes
six native installers from main and the separate seven-file update feed. Release
notes retain the Windows/macOS/Linux by x64/arm64 direct-download table. Agent,
SDK and adapter pins and the existing signing policy are unchanged.
