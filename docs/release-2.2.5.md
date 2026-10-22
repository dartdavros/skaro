# Skaro 2.2.5

## Changes

- Added a system tray with Open Skaro, current working/waiting counts, Settings,
  Help center, an available-update action and Quit.
- Closing the window hides it by default while agents keep working. The existing
  Appearance settings card contains the persistent close-to-tray switch.
- Real exits with working, starting, queued or waiting agents require a native
  confirmation. Cancel keeps the session alive; Quit uses the normal service
  shutdown. Reopening restores the same window and renderer.
- Preserved the redesigned About screen with the application logo and links to
  the help center, website, issue tracker and Andrey Ermolaev.
- Included the published help center sources: ten English articles, authentic
  screenshots, explanatory diagrams, validation/publication utilities and the
  original publication receipt. Their screenshots document release 2.2.4.

## Verification before release

The tray production build, desktop typecheck, changed-file lint and formatting
passed. Native Windows checks covered hiding, backend availability, the unchanged
renderer process, reopening, preference persistence and closing with the switch
disabled. Settings screenshots at 1500 and 960 px were inspected.

A real installed Claude Code session remained live and waiting for its question
after hiding the window. The native quit warning was inspected; Cancel preserved
the session, and confirming Quit closed the application after service teardown.
No mock backend or response overrides were used for these checks.

The help center's preparation tool validated ten articles, three categories and
fifteen images. The About tests include both UI languages and explicitly select
their locale instead of depending on the operating system language.

Pinned agent, SDK and adapter versions are unchanged from 2.2.4. On 22 October
2026 the owner explicitly authorized the existing full fixture/HTTP test suite
and reuse of the previously accepted canary/model checks with the recorded Claude
limitation. This authorizes `test_fixtures_allowed` and `agents_verified` for this
release; it does not claim a new successful canary run.

## Distribution

Both the bundle and displayed application version are 2.2.5. Publication uses
the standard workflow from the merged main commit, with six native installers
and the separate seven-file update feed. Release notes retain the required
Windows/macOS/Linux by x64/arm64 direct-download table.

Native tray interaction on macOS/Linux, operating-system shutdown and installing
an update were not exercised on the local Windows host. Builds retain the
project's existing unsigned/ad-hoc signing policy; macOS updates remain manual.
