import { app } from 'electron';
import { focusWindow, mainWindow } from './app-window';
import { sendEvent, type Handlers } from './ipc';
import { ShutdownPaint } from './shutdown-paint';
import { ShutdownProgress } from './shutdown-progress';

export class ShutdownWindow {
  private readonly paint = new ShutdownPaint();
  private immediateExitRequested = false;
  readonly progress = new ShutdownProgress((state) => {
    const window = mainWindow();
    if (window && !window.isDestroyed()) sendEvent(window.webContents, 'app.shutdown', state);
  });
  readonly handlers: Pick<
    Handlers,
    'app.shutdownState' | 'app.shutdownPainted' | 'app.shutdownNow'
  > = {
    'app.shutdownState': () => this.progress.state,
    'app.shutdownPainted': (startedAt) => this.paint.painted(startedAt),
    'app.shutdownNow': () => {
      if (!this.progress.state) throw new Error('Application shutdown has not started');
      if (this.immediateExitRequested) return;
      this.immediateExitRequested = true;
      // An explicit owner action bypasses remaining cleanup; never report those stages as done.
      setImmediate(() => app.exit(0));
    },
  };

  async show(endingSession: boolean): Promise<void> {
    const state = this.progress.begin();
    const window = mainWindow();
    if (!window || window.isDestroyed()) return;
    if (!endingSession) focusWindow();
    if (window.isVisible()) await this.paint.wait(state.startedAt);
  }
}
