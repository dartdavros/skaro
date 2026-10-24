# Skaro 2.2.8

## Changes

- A merge over local edits is verified by the D-45 rule: the mandatory project
  checks and the checks its merge agent submits for the resolution. Saved checks
  of earlier accepted tasks are no longer re-run; dependency preparation keeps
  its regression plan.
- A merge candidate saved before the fix drops the inherited checks once at
  startup and returns to its merge agent, keeping the candidate, project checks,
  the agent's own checks and earlier run results.
- `verify_integration` accepts a replacement under any name its command was
  saved with and replaces every copy.
- Skaro adds `localhost`, `127.0.0.1` and `::1` to `NO_PROXY` at startup,
  keeping the owner's exclusions. A local proxy from `HTTP_PROXY` no longer
  carries agent requests to Skaro's MCP server: those calls had failed with
  HTTP 503 after 600 seconds.

## Verification

Targeted planner and proxy tests (14), the local-changes merge tests on real
Git and SQLite (6), desktop main TypeScript, ESLint, Prettier and a production
build passed. The migration was checked on a copy of the real T-168 operation:
151 checks reduced to the project and agent checks. The installed Codex 0.159.2
was checked against the local xray proxy: without the exclusion its MCP
connections came from xray, with the exclusion directly from Codex. A local
request through xray was cut with HTTP 503 after 600 seconds. These probes used
the real MCP server class and a temporary hold server without owner approval.
The fix was not exercised in the running owner application before release.

On 24 October 2026 the owner ordered this release without further questions.
As for the previous releases, the existing full release suite with isolated
fixtures and HTTP test servers runs in CI, and the Codex/Claude canary and
model checks recorded for 2.2.6 are reused. Agent, SDK and adapter pins are
unchanged; no fresh canary runs are claimed.

## Distribution

Both the bundle and displayed application version are 2.2.8. The standard
workflow publishes six native installers and the separate seven-file update
feed from main. Release notes retain the Windows/macOS/Linux by x64/arm64
download table. The existing signing policy is unchanged.
