import { app, Menu, shell, Tray } from 'electron';
import { windowIcon } from './app-icon';
import { focusWindow, mainWindow } from './app-window';
import { sendEvent } from './ipc';
import { HELP_CENTER_URL } from '../shared/app-shell';
import type { AgentActivity } from './app-agent-activity';
import { trayText } from './tray-i18n';

interface TrayOptions {
  locale: () => string;
  activity: () => AgentActivity;
  updateAvailable: () => boolean;
}

/** Own the native tray and rebuild its menu only when visible metadata changes. */
export class AppTray {
  private readonly tray: Tray;
  private readonly options: TrayOptions;
  private timer?: NodeJS.Timeout;
  private signature = '';

  constructor(options: TrayOptions) {
    this.options = options;
    const size = process.platform === 'darwin' ? 16 : 20;
    const icon = windowIcon().resize({ width: size, height: size });
    if (icon.isEmpty()) throw new Error('The Skaro tray icon could not be loaded');
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    this.tray = new Tray(icon);
    this.tray.on('click', focusWindow);
    this.tray.on('double-click', focusWindow);
    this.refresh();
  }

  available(): boolean {
    return !this.tray.isDestroyed();
  }

  schedule(): void {
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.refresh();
    }, 150);
  }

  refresh(): void {
    if (!this.available()) return;
    const locale = this.options.locale();
    const { working, waiting } = this.options.activity();
    const update = this.options.updateAvailable();
    const signature = JSON.stringify([locale, working, waiting, update]);
    if (signature === this.signature) return;
    this.signature = signature;
    const text = trayText(locale);
    const navigate = (destination: 'settings' | 'updates') => {
      focusWindow();
      const window = mainWindow();
      if (window) sendEvent(window.webContents, 'app.navigate', destination);
    };
    this.tray.setToolTip(`Skaro — ${text.status(working, waiting)}`);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: text.open, click: focusWindow },
        { label: text.status(working, waiting), enabled: false },
        { type: 'separator' },
        { label: text.settings, click: () => navigate('settings') },
        { label: text.help, click: () => void shell.openExternal(HELP_CENTER_URL) },
        ...(update ? [{ label: text.update, click: () => navigate('updates') }] : []),
        { type: 'separator' },
        { label: text.quit, click: () => app.quit() },
      ]),
    );
  }

  destroy(): void {
    clearTimeout(this.timer);
    this.tray.destroy();
  }
}
