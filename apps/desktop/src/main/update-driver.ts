import electronUpdater, { type AppUpdater } from 'electron-updater';
import type { ReleaseManifest } from './update-release';
import { RELEASE_ROOT, releasePlatform } from './update-release';
import type { Platform } from '@skaro/core';

/** The actual NSIS / Squirrel.Mac / AppImage updater; never enabled against a dev checkout. */
export class UpdateDriver {
  private readonly updater: AppUpdater = electronUpdater.autoUpdater;
  private readonly platform: Platform;
  private readonly packaged: boolean;
  private onFailure?: (error: Error) => void;
  constructor(platform: Platform, packaged: boolean) {
    this.platform = platform;
    this.packaged = packaged;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowDowngrade = false;
    this.updater.allowPrerelease = false;
    // Errors also reject check/download; a listener avoids an unhandled EventEmitter error.
    this.updater.on('error', (error) => this.onFailure?.(error));
  }

  async download(
    manifest: ReleaseManifest,
    progress: (percent: number) => void,
  ): Promise<string[]> {
    if (!this.packaged || (this.platform.os === 'linux' && !process.env['APPIMAGE']))
      throw new Error('UPDATES_PACKAGED_ONLY');
    const selected = releasePlatform(manifest, this.platform);
    this.updater.setFeedURL({
      provider: 'generic',
      url: `${RELEASE_ROOT}/download/v${manifest.bundleVersion}/`,
      channel: this.platform.os === 'linux' ? 'latest' : `latest-${this.platform.arch}`,
      useMultipleRangeRequest: false,
    });
    const checked = await this.updater.checkForUpdates();
    const payload = checked?.updateInfo.files.find((file) => file.url === selected.payload.name);
    if (
      checked?.updateInfo.version !== manifest.bundleVersion ||
      payload?.sha512 !== selected.payload.sha512
    )
      throw new Error('Electron update payload does not match the bundle');
    const listener = (value: { percent: number }) =>
      progress(Math.max(0, Math.min(100, value.percent)));
    this.updater.on('download-progress', listener);
    try {
      return await this.updater.downloadUpdate();
    } finally {
      this.updater.removeListener('download-progress', listener);
    }
  }

  apply(): void {
    this.updater.quitAndInstall(false, true);
  }
  onApplyFailure(listener: (error: Error) => void): void {
    this.onFailure = listener;
  }
}
