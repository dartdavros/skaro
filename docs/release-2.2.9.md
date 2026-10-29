# Skaro 2.2.9

## Changes

- A merge candidate saved before D-45 now drops the whole replacement chain of
  every inherited check. A saved check of an earlier accepted task that its
  merge agent repaired more than once (for example wrapped again into a cached
  script) no longer stays in the merge plan; the project checks and the agent's
  own resolution checks are kept.

## Verification

The planner tests for merge checks (13) including a new chain regression,
desktop main TypeScript, ESLint and Prettier passed. The migration was checked
on a copy of the real T-168 operation: 152 checks, of which 2.2.8 would have
kept 12 (8 of them repaired checks of T-056, T-058, T-062 and T-084), reduced to
the 4 checks its merge agent wrote for the resolution. The fix was not
exercised in the running owner application before release.

On 30 October 2026 the owner ordered this release without further questions.
As for the previous releases, the existing full release suite with isolated
fixtures and HTTP test servers runs in CI, and the Codex/Claude canary and
model checks recorded for 2.2.6 are reused. Agent, SDK and adapter pins are
unchanged; no fresh canary runs are claimed.

## Distribution

Both the bundle and displayed application version are 2.2.9. The standard
workflow publishes six native installers and the separate seven-file update
feed from main. Release notes retain the Windows/macOS/Linux by x64/arm64
download table. The existing signing policy is unchanged.
