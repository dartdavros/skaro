# Install Skaro on Linux

Skaro for Linux is distributed as an AppImage. Download the correct architecture, make the file executable and run it as your normal user.

## 1. Choose your architecture

Check the machine architecture in a terminal:

```sh
uname -m
```

Choose **x64** in the release table for `x86_64`, or **arm64** for `aarch64`/`arm64`. The Linux x64 filename uses `x86_64`, even though the table column is called x64.

![Linux downloads use AppImage: x86_64 for x64, or arm64 for ARM64.](../images/download-guide.svg)

## 2. Download the AppImage

Open the [latest official Skaro release](https://github.com/dartdavros/skaro/releases/latest). In its download table, select **Linux → x64** or **Linux → arm64**. Download the `.AppImage`, not a source-code archive.

Keep it in a location you intend to retain. Unlike a conventional package installer, the AppImage is the executable you will launch.

## 3. Make it executable and launch it

In your file manager, open the downloaded file's **Properties → Permissions** and enable execution as a program. Labels vary between desktop environments. Then open the AppImage.

Alternatively, use a terminal. For the x64 file from release 2.2.4, for example:

```sh
cd "$HOME/Downloads"
chmod u+x ./Skaro-2.2.4-linux-x86_64.AppImage
./Skaro-2.2.4-linux-x86_64.AppImage
```

Use the actual directory, version and architecture in your downloaded filename. For ARM64, the filename ends in `linux-arm64.AppImage`.

Run Skaro as your normal user, not with `sudo`. The [AppImage documentation](https://docs.appimage.org/user-guide/run-appimages.html) describes executable permissions and launching AppImages.

<!-- OWNER IMAGE LINUX-01: The real downloaded AppImage in the file manager, with its full filename visible. -->
<!-- OWNER IMAGE LINUX-02: File Properties → Permissions with execution enabled. -->
<!-- OWNER IMAGE LINUX-03: Skaro running on the Linux desktop. -->

## If the AppImage does not open

Start it from a terminal to read the actual error.

- **Permission denied:** check executable permissions and whether the file's filesystem allows execution.
- **Exec format error:** check that the architecture matches `uname -m` and download the right file.
- **A FUSE or libfuse error:** first confirm the exact message. Some AppImages require a FUSE compatibility library; package names vary by distribution. The [official FUSE troubleshooting guide](https://docs.appimage.org/user-guide/troubleshooting/fuse.html) describes the relevant packages, including the `libfuse2t64` name on Ubuntu 24.04. Do not replace FUSE 3 blindly or install packages just because an unrelated guide mentions them.
- **A Chromium sandbox error:** retain the message and check your distribution's policy. Disabling the sandbox is not part of the standard installation procedure.

Current Skaro releases do not provide a publisher signing certificate. Download the AppImage from the official release; file permissions alone do not establish trust in a download.

## Next steps

[Connect an agent](/articles/connect-agents), then [open your first project](/articles/start-here). To keep Skaro current, see [Update Skaro and Its Agents](/articles/update-skaro). If startup still fails, include the terminal error when [asking for help](/articles/troubleshooting).
