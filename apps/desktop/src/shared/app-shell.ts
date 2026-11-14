import type { ShutdownState } from './shutdown';

export const CLOSE_TO_TRAY_SETTING = 'window.closeToTray';
export const CLOSE_TO_TRAY_DEFAULT = true;
export const HELP_CENTER_URL = 'https://help.skaro.dev/';

export interface ShellEvents {
  'app.navigate': 'settings' | 'updates';
  'app.shutdown': ShutdownState;
}
export interface ShellMethods {
  'app.shutdownState': () => ShutdownState | undefined;
  'app.shutdownPainted': (startedAt: number) => void;
  'app.shutdownNow': () => void;
}
