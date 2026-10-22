import { app, dialog, powerMonitor, type Event } from 'electron';
import { focusWindow, mainWindow } from './app-window';
import { trayText } from './tray-i18n';

interface LifecycleOptions {
  closeToTray: () => boolean;
  busy: () => boolean;
  locale: () => string;
  shutdown: () => Promise<void>;
}

/** Window hiding never enters shutdown. All actual exits share one guarded teardown. */
export class AppLifecycle {
  private phase: 'running' | 'confirming' | 'stopping' | 'stopped' = 'running';
  private endingSession = false;
  private confirmation?: AbortController;
  private readonly options: LifecycleOptions;

  constructor(options: LifecycleOptions) {
    this.options = options;
    app.on('before-quit', (event) => {
      if (this.phase === 'stopped') return;
      event.preventDefault();
      void this.quit();
    });
    powerMonitor.on('shutdown', (event?: Event) => {
      event?.preventDefault();
      this.endSession();
    });
  }

  close(event: Event): void {
    if (this.phase === 'stopped') return;
    event.preventDefault();
    if (this.phase !== 'running') return;
    if (!this.endingSession && this.options.closeToTray()) mainWindow()?.hide();
    else void this.quit();
  }

  stopping(): boolean {
    return this.phase === 'stopping' || this.phase === 'stopped';
  }

  endSession(): void {
    this.endingSession = true;
    this.confirmation?.abort();
    void this.quit();
  }

  private async quit(): Promise<void> {
    if (this.phase !== 'running') return;
    if (!this.endingSession && this.options.busy()) {
      this.phase = 'confirming';
      focusWindow();
      const text = trayText(this.options.locale());
      this.confirmation = new AbortController();
      const options = {
        type: 'warning' as const,
        title: 'Skaro',
        message: text.confirm,
        detail: text.detail,
        buttons: [text.cancel, text.exit],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        signal: this.confirmation.signal,
      };
      try {
        const window = mainWindow();
        const result = await (window
          ? dialog.showMessageBox(window, options)
          : dialog.showMessageBox(options));
        if (result.response !== 1 && !this.endingSession) {
          this.phase = 'running';
          return;
        }
      } catch (error) {
        console.error('Quit confirmation:', error);
        this.phase = 'running';
        if (!this.endingSession) return;
      } finally {
        this.confirmation = undefined;
      }
    }
    this.phase = 'stopping';
    try {
      await this.options.shutdown();
    } catch (error) {
      console.error('Application shutdown:', error);
    } finally {
      this.phase = 'stopped';
      app.quit();
    }
  }
}
