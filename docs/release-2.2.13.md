# Skaro 2.2.13

## Changes

- Coding agents now connect through one registry. Each adapter owns its runtime,
  native history projector, presentation metadata, pinned distribution and
  configuration details. Adding an agent requires its adapter package and one
  registration, plus the usual workspace dependency and lockfile update.
- Task and chat sessions, the native worker, history replay, settings, installer
  metadata and updates all use the registered definitions. Unknown agent IDs are
  rejected instead of silently selecting Claude Code.
- Claude Code and Codex retain their existing UI, model choices, native session
  behavior, pinned versions and install locations. No new agent or UI state is
  introduced. Manifest schema 1 and its Claude SDK compatibility field remain
  compatible with previous clients.
- The decision and extension boundaries are documented in
  [ADR-0046](adr/0046-agent-registry.md).
- Closing a chat now waits for an in-flight planning continuation to settle.
  Cancelled continuations discard stale wakeups and errors, so they cannot
  restart after cancellation or access storage that is already closing.

## Verification

The production build, affected package type checks, ESLint, Prettier and all 25
targeted tests passed. Two native Electron browser checks passed using an isolated
copy of a real project: the settings screen with real models and configuration,
and Codex answering through the worker, persisting its log, restoring after an
application restart and continuing the same native session.

Eight actual saved Claude histories were checked without generation: 6,569 events
across 12 segments, including 3 question interactions and 16 approval requests.
Direct projection, registry projection, background replay and restored snapshots
matched. The registry creates the existing Claude adapter, and its real CLI
returned account status, 11 models, 65 commands and the existing configuration.

The owner explicitly waived live Claude generation, resume and interruption
checks because the account requires Anthropic verification. No successful live
Claude generation is claimed. The earlier interruption timeout also reproduces
with direct construction of the existing adapter, without the registry.

On 31 October 2026 the owner authorized the standard full release suite with its
existing isolated fixtures and HTTP test servers. The release workflow must pass
the full checks before packaging and publishing. Unchanged agent pins reuse the
accepted verification with the explicitly retained Claude limitation; no new
successful Claude canary is claimed.

## Distribution

Bundle and displayed application version: 2.2.13. Publication uses the standard
workflow from main, six native installers and the separate seven-file update
feed. Public release notes include the Windows/macOS/Linux by x64/arm64 table of
direct installer links. Agent/SDK pins, adapter package versions and publisher
signing policy remain unchanged.
