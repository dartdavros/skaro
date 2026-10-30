# Skaro 2.2.11

## Changes

### Merges

- A merge preserves the owner's uncommitted edits from every folder it changes,
  not only the files the task changed. A local file's uncommitted siblings no
  longer stay out of the candidate and collide with the agent's copies at
  publication.
- A merge plan keeps only the project checks and the checks written for the
  resolution. Repaired inherited checks are recognized by name, also after an
  earlier migration lost their chain, and Skaro verifies the retained candidate
  itself, starting the candidate's own environment first.
- A failed publication of a verified candidate repeats the publication without
  a new verification or its agent.
- A merge whose tasks are already in the base branch closes at startup without
  starting its agent. A newer candidate supersedes stopped ones of its task.
- Replacing a file retries for a few seconds when another process holds it for
  a moment (EPERM, EACCES, EBUSY) in publication, task files and C4 documents.

### What the owner sees

- A task agent that stops without a question card no longer leaves the task
  silent: Skaro shows the card itself. After a refused submission it offers the
  unmet criteria with "Принять как есть" or "Доделать"; otherwise it asks for
  the reply the agent awaits. Opening a task that stopped earlier shows it too.
- Accepting or rejecting a task's architecture package continues its agent.
- Checks that Skaro runs on a candidate appear in the feed as command rows with
  live output, exit code and duration.
- A title bar button lists Skaro's own work: indexing, removal of environments
  and merge copies, Docker cleanup, with outcomes and repeats merged in one row.
- Cards above the input keep the width of the input.

### Disk use

- The code index removes every row of expired snapshots. A time budget let them
  outgrow the cleanup: on the owner's machine 97% of the rows of a 10 GB index.
- After a confirmed update only the latest application backup stays.
- Environment cleanup and an hourly pass remove anonymous volumes without
  containers, untagged images and build cache unused for a day. Named volumes
  are not touched.
- Finished merges lose their environment and checkout at startup.

### Updates

- "Обновить" downloads the newest published release. A downloaded update no
  longer stops update checks, and one overtaken by a newer installation is
  retired at startup.

## Verification

Targeted tests of the merge plan, local-changes merges on real Git, the updater
controller, background work, the wait card and index cleanup passed, with desktop
TypeScript, svelte-check, ESLint and Prettier. In the owner's running application:
T-169 went from start to main through Skaro (`8fa73aad`) with its local edits kept
and no repeated verification; the criteria card appeared and its answer started
the merge; the background window was confirmed by the owner.

Not exercised live: continuing an agent after an architecture decision and
repeating a failed publication. The cause of one long lock of a specification
file by a previous Skaro process was not found; it did not recur during an hour of
observation, and the retry does not outlast such a lock. T-168 was merged by hand
on the owner's order from the commit Skaro had prepared.

Locally `task-environments.test.ts` (2) and `git.test.ts` (3) fail with or without
these changes. On 30 October 2026 the owner ordered this release. As for previous
releases, the full suite runs in CI and the Codex/Claude canary and model checks
recorded for 2.2.6 are reused; pins are unchanged and no fresh canary runs are claimed.

## Distribution

Both the bundle and displayed application version are 2.2.11. The standard workflow
publishes six native installers and the separate seven-file update feed from main.
Release notes retain the Windows/macOS/Linux by x64/arm64 download table. The
existing signing policy is unchanged.
