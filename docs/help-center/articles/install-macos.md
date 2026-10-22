# Install Skaro on macOS

Skaro is distributed as a DMG for Apple Silicon and Intel Macs. Current releases have an ad-hoc signature for technical compatibility, but no Apple Developer ID signature or Apple notarization. macOS may block the first launch.

## 1. Choose Apple Silicon or Intel

Open **Apple menu → About This Mac**. If the window shows an Apple **Chip** such as an M-series chip, choose **arm64**. If it shows an Intel **Processor**, choose **x64**.

![Choose arm64 for Apple Silicon or x64 for Intel, then download the macOS DMG.](../images/download-guide.svg)

<!-- OWNER IMAGE MAC-01: About This Mac showing Chip or Processor. Crop personal identifiers. -->

## 2. Install from the DMG

1. Open the [latest official Skaro release](https://github.com/dartdavros/skaro/releases/latest).
2. In the download table, select **macOS → arm64** or **macOS → x64**. The file ends in `mac-arm64.dmg` or `mac-x64.dmg`.
3. Open the DMG and copy **Skaro.app** to **Applications**. Run the installed copy from Applications rather than leaving it inside the mounted disk image.
4. Eject the disk image after copying is complete.

The **Source code** archives on the release page are not application installers.

<!-- OWNER IMAGE MAC-02: The real mounted Skaro DMG and the copy-to-Applications step. -->

## 3. Allow the first launch if you trust the download

Try opening Skaro from Applications. If macOS says it cannot verify the developer or cannot check the app for malicious software:

1. Dismiss the alert, then open **System Settings → Privacy & Security**.
2. Find the message about Skaro being blocked. You may need to scroll to the Security section.
3. If **Open Anyway** is available, choose it only after checking that you downloaded the app from the official `dartdavros/skaro` release.
4. Complete the confirmation yourself and open Skaro again if requested.

The exception is for this app. It does not require disabling Gatekeeper or changing the computer to allow every downloaded app. The exact alert depends on the macOS version and security policy.

<!-- OWNER IMAGE MAC-03: The actual first-launch warning, using the English macOS interface. -->
<!-- OWNER IMAGE MAC-04: Privacy & Security with the Skaro-specific Open Anyway action. -->

If macOS says the app **will damage your computer**, do not treat that as an unidentified-developer prompt. If it reports that the app is **damaged**, verify the architecture and download a fresh official copy; do not assume the same exception will solve it. See [Apple's explanation of these alerts](https://support.apple.com/en-us/102445).

## 4. Connect an agent

Once Skaro opens, [connect Codex or Claude Code](/articles/connect-agents). Then [connect an existing project or create a new one](/articles/start-here). You can select English under **Settings → Appearance**.

<!-- OWNER IMAGE MAC-05: Skaro running from Applications after a successful first launch. -->

## Updating on macOS

**Current unsigned releases require manual updates on macOS.** Wait for active work to finish, quit Skaro, download the new DMG for the same architecture and replace Skaro.app in Applications. Do not remove project folders or application data as an update step.

See [Update Skaro and Its Agents](/articles/update-skaro). If an administrator manages your Mac or **Open Anyway** is unavailable, ask the administrator rather than weakening system security settings.
