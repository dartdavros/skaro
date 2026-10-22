# Update Skaro and Its Agents

Skaro updates a compatible application bundle, including its managed agent versions and adapters. Use the built-in update flow where supported, or download the installer from the official release.

## Check your installed version

Open **Settings → About**. The version appears next to Skaro. Click **Check for updates** to check manually. Skaro also checks automatically.

![Settings → About shows the installed version and Check for updates.](../images/about.jpg)

An update-check error is not confirmation that you have the latest version. If the check fails, retry when the network is available or compare your version with the [official release page](https://github.com/dartdavros/skaro/releases/latest).

## Windows and Linux

When a compatible update is available, the **Updates available** button opens the updates dialog. Review the component versions and **Release notes**, then choose **Update** to download. Opening the dialog alone does not start a download.

After the download completes, use **Restart and apply**. Finish active tasks, chats and documentation imports before applying; Skaro may prevent application while work is active. Restarting is a deliberate action, not something to do halfway through an agent's turn.

Only installed agents need their matching updates. Do not separately replace Skaro-managed binaries with an arbitrary newer CLI version.

For a manual update, finish active work, quit Skaro and download the installer for the same OS and architecture. On Windows, run the new EXE. On Linux, keep and launch the new executable AppImage; update any shortcut you created yourself to point to the new file. The filename can change with the version.

## macOS: install the new DMG manually

Current macOS releases have no Developer ID certificate or notarization. **Automatic update installation is not supported for these releases.**

1. Finish active work and quit Skaro.
2. Download the new DMG for Apple Silicon (**arm64**) or Intel (**x64**).
3. Copy the new **Skaro.app** to **Applications**, replacing the older application when prompted.
4. Open the installed application. If macOS blocks the new copy, follow the app-specific steps in [Install Skaro on macOS](/articles/install-macos).
5. Confirm the new version in **Settings → About**.

<!-- OWNER IMAGE MAC-UPDATE-01: Actual Finder confirmation replacing Skaro.app in Applications with a newer release. -->

## Keep your projects and account data

Do not delete `.skaro/`, your project folders or application data as an update step. Normal updates preserve project information, authorization and saved model selections. Back up important projects as part of your usual workflow.

Integrity checks help detect an incomplete or changed download; they do not provide a publisher identity for an unsigned release.

## If an update fails

Read the error and retry the failed stage rather than repeatedly restarting active work. If the app reports a bundle mismatch or cannot start its agents after an update, do not manually mix old and new component files. Keep the error details and [ask for help](/articles/troubleshooting).

If reinstalling manually, use the matching official installer: [Windows](/articles/install-windows), [macOS](/articles/install-macos) or [Linux](/articles/install-linux).
