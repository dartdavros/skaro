# Screenshot inventory

Captured on Windows from the real installed Skaro 2.2.4 on 22 October 2026.
The UI language was temporarily changed from Russian to English for capture.
No mock bridge, fake backend, seeded project, fabricated conversation or simulated
OS alert was used. Existing project documents remain in their original language.

| File | Actual source |
|---|---|
| `images/new-project.jpg` | New project dialog, no project created |
| `images/appearance.jpg` | Settings → Appearance, English selected |
| `images/about.jpg` | Settings → About, installed version 2.2.4 |
| `images/task-and-branch-settings.jpg` | Existing global run and Git settings; viewed without changing them |
| `images/task-board.jpg` | Existing Chatballs task board |
| `images/project-plan.jpg` | Existing Chatballs milestone and dependencies |
| `images/task-agent.jpg` | Agent and model section of existing task T-167 |
| `images/task-permissions.jpg` | Permissions, isolation and Plan first for T-167; dialog cancelled without saving |
| `images/project-chat.jpg` | Actual empty project chat in Skaro; no prompt sent |
| `images/remaining-quota.jpg` | Actual provider quota response, no account identifier shown |
| `images/task-result.jpg` | Existing task result; see the article caption for scope |
| `images/github-release.jpg` | Public GitHub release v2.2.4 with the six download links |

`download-guide.svg`, `project-workflow.svg` and `task-isolation.svg` are explanatory
diagrams, not UI screenshots. They use the existing dark neutral palette. They
illustrate documented behavior without pretending to be application screens.

## Owner images to add later

The owner will supply macOS and Linux images. Their insertion points are HTML
comments in the Markdown sources; publication strips those comments. There are
no deliberately broken image links or editor notes in the public articles.

| Marker | Capture | Suggested English caption / alt text |
|---|---|---|
| MAC-01 | About This Mac, Chip or Processor; omit serial number | Check whether your Mac uses Apple Silicon or an Intel processor. |
| MAC-02 | Actual Skaro DMG and copy into Applications | Copy Skaro.app from the disk image to Applications. |
| MAC-03 | Actual Gatekeeper alert for Skaro | macOS may block the first launch because this release is not notarized. |
| MAC-04 | Privacy & Security, Skaro-specific Open Anyway | Allow this copy of Skaro through Privacy & Security after checking its source. |
| MAC-05 | Skaro launched from Applications | Skaro running on macOS after the first-launch confirmation. |
| MAC-UPDATE-01 | Finder confirmation replacing Skaro.app | Replace the installed application with the newer Skaro.app. |
| LINUX-01 | Downloaded AppImage in file manager | Download the AppImage that matches your processor architecture. |
| LINUX-02 | File permissions, executable enabled | Allow the Skaro AppImage to execute as a program. |
| LINUX-03 | Actual Skaro window on Linux | Skaro running from the AppImage on Linux. |

## Windows installer and security alerts

The Windows article includes real release-page and installed-app screenshots.
The installed app was already at 2.2.4. It was not reinstalled or downgraded just
to reproduce a security prompt. SmartScreen and installer-progress screenshots
have not been captured. The article describes the conditional prompt in text,
links Microsoft's documentation and explicitly identifies the installed-app shot.
Do not substitute a drawn or unrelated application's warning as a Skaro screenshot.

## Future refreshes

Use the real released application. Review visible content before publishing:
exclude account emails, secrets, private conversations and unrelated projects.
Do not change task data or security settings to stage a screenshot. A screenshot
of a view is not proof that the workflow was executed or tested in this task.
