# Application icon

`icon.svg` is the original `logo-color.svg` supplied by the owner on 2026-09-29,
copied without modifying the artwork (SHA-256
`37ae747f4ec12bdbb5af84ce7ec5e61c16565fc42e97b7b35f9d596ff931b2c8`).

The raster exports preserve its gradient and transparent background:

- `icon.png`: 1024 × 1024 RGBA, the SVG contained in a square canvas.
- `icon.ico`: Windows sizes 16, 24, 32, 48, 64, 128 and 256.
- `icon.icns`: macOS sizes through 1024, including Retina representations.

Electron Builder uses the platform-specific files for application packaging.
The PNG is also copied to `resources/icon.png` for the packaged window icon;
development loads the same PNG from this directory. The macOS dock uses it too.

Windows verification: the unpacked `Skaro.exe` contains the supplied logo,
and the packaged PNG matches the source export. macOS and Linux packages have
not been built on this Windows machine.
