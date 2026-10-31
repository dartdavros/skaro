Skaro 2.2.12

- Authorized tasks continue across model turns through verification and submission,
  then merge automatically when automatic merging is enabled.
- Execution intent survives restarts and respects explicit stops, real questions,
  architecture decisions and concrete external blockers.
- Removed invented reply questions after an agent turn and retired legacy cards.
- Architecture package decisions resume existing tasks without another owner message.
- Task environments can start declared existing source services and wait for readiness
  before copying data, without recreating the source containers or replacing data.
- Repeated turns without progress stop instead of looping indefinitely.

Verified with real Codex execution through a Git merge and native Electron checks.
See docs/release-2.2.12.md for verification details and limits.

Installers are published for Windows, macOS and Linux, for x64 and arm64.
The published GitHub release includes the verified table of six direct installer links.
