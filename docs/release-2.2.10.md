# Skaro 2.2.10

## Changes

- «Обновить» downloads the newest published release. Before, it downloaded the
  release found by the last check, which could be hours old: a Skaro started
  before 2.2.9 was published offered and downloaded 2.2.8.
- A downloaded but not applied update no longer stops update checks. A newer
  release replaces it in the offer; a failed check keeps the downloaded update.
- A downloaded update overtaken by a newer installation (for example an
  installer run by hand) is retired at startup instead of being offered again.
- A merge plan migrated by 2.2.8, which kept the repairs of repaired inherited
  checks, is migrated once more. A paused merge whose inherited checks were the
  blocker returns to its merge agent too.

## Verification

Updater controller tests (2, new), release/recovery and activity tests, the
merge-check planner tests and the local-changes merge tests passed, with
desktop main TypeScript, ESLint and Prettier. The new controller tests fail on
2.2.9. The merge migration was run on a copy of the real paused T-168
operation, unmarked and as marked by 2.2.8: both reduce 152 checks to the 4
checks its merge agent wrote for the resolution and return it to the agent.
The fix was not exercised in the running owner application before release.

On 30 October 2026 the owner ordered this release. As for the previous
releases, the existing full release suite with isolated fixtures and HTTP test
servers runs in CI, and the Codex/Claude canary and model checks recorded for
2.2.6 are reused. Agent, SDK and adapter pins are unchanged; no fresh canary
runs are claimed.

## Distribution

Both the bundle and displayed application version are 2.2.10. The standard
workflow publishes six native installers and the separate seven-file update
feed from main. Release notes retain the Windows/macOS/Linux by x64/arm64
download table. The existing signing policy is unchanged.
