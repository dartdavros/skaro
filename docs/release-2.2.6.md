# Skaro 2.2.6

## Changes

- Architecture proposals keep a compact receipt in the conversation. Full document
  bodies, embedded model copies and raw JSON diffs are loaded only in package review.
- Package review separates authored document edits, C4 object changes and legacy
  generated copies. Before/after views use the immutable proposed package; the C4
  gallery continues to show the accepted architecture until the owner applies it.
- New architecture packages store the C4 model once and attach accepted views when
  reading documents. An explicit reviewed migration can remove old embedded copies.
- Text comparison uses a bounded Myers diff. Exhausting its budget reports an
  unavailable comparison instead of presenting a fabricated full-file replacement.
- Acceptance verifies the fingerprint of the reviewed package. Agent receipts state
  that the package is pending and that nothing has been applied.

## Verification

The owner confirmed visual verification of the interface on 23 October 2026.
Automated Windows UI control was stopped at the owner's request and is not resumed.
The existing full release suite with isolated fixtures and HTTP test servers was
explicitly authorized. Fresh canary/model checks are required for both pinned agents;
previous canary results are not substituted for this release. Fresh read, edit and
question scenarios passed for Codex 0.159.2 and Claude Code 2.1.285. Both model probes
and the Codex protocol export passed. Records remain in local `output/`.

Production build, repository lint, formatting and release package typechecks passed.
The targeted C4/diff checks passed (16 tests). The first full Windows run failed with
Docker unavailable, concurrent filesystem timeouts and follow-on cleanup errors;
it is not reported as a successful suite. The full CI suite remains a publication
gate. These local failures do not waive any required CI checks.

Read-only regression checks against the original saved Chatballs package identify
nine authored documents (+95 / -34 lines), 34 generated copies and four added C4
objects. They verify that the proposal and working files remain unchanged.

## Distribution

Both the bundle and displayed application version are 2.2.6. The standard workflow
publishes six native installers and the separate seven-file update feed from main.
The release description retains the Windows/macOS/Linux by x64/arm64 download table.
Agent, SDK and adapter pins and the existing signing policy are unchanged.
