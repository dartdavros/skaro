import { app, BrowserWindow, screen, shell } from 'electron';
import { join } from 'node:path';
import { windowIcon } from './app-icon';
import { sendEvent } from './ipc';
import type { AppState } from './state';
import { trace } from './trace';

interface Bounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

let win: BrowserWindow | undefined;
let state: AppState | undefined;

function savedBounds(): Bounds {
  const saved = state?.getSetting('window.bounds') as Bounds | null | undefined;
  const fallback: Bounds = { width: 1280, height: 800 };
  if (!saved || typeof saved.width !== 'number') return fallback;
  // Forget the position if the display it was on is gone.
  const visible =
    saved.x === undefined ||
    saved.y === undefined ||
    screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return (
        saved.x! >= a.x - 50 &&
        saved.y! >= a.y - 50 &&
        saved.x! < a.x + a.width &&
        saved.y! < a.y + a.height
      );
    });
  return visible ? saved : { width: saved.width, height: saved.height, maximized: saved.maximized };
}

export function createMainWindow(): void {
  const bounds = savedBounds();
  trace('bounds read');
  const mac = process.platform === 'darwin';
  const icon = windowIcon();
  if (mac) app.dock?.setIcon(icon);
  win = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Skaro',
    icon,
    backgroundColor: '#0f0f0f',
    // Frameless: the top bar with project tabs is the title bar (plan, stage 4).
    frame: mac,
    ...(mac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  const current = win;
  trace('window created');
  current.once('ready-to-show', () => {
    trace('window ready to show');
    if (bounds.maximized) current.maximize();
    current.show();
  });
  current.webContents.once('did-finish-load', () => trace('renderer loaded'));
  current.webContents.on('render-process-gone', (_e, details) =>
    trace(`renderer gone: ${details.reason}`),
  );
  current.on('unresponsive', () => trace('window unresponsive'));

  const saveBounds = () => {
    if (current.isDestroyed() || current.isMinimized()) return;
    const b = current.getNormalBounds();
    state?.setSetting('window.bounds', { ...b, maximized: current.isMaximized() });
  };
  // Saved as soon as the user stops dragging: a killed process never gets to "close".
  let boundsTimer: NodeJS.Timeout | undefined;
  const saveBoundsSoon = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveBounds, 400);
  };
  current.on('resize', saveBoundsSoon);
  current.on('move', saveBoundsSoon);
  current.on('close', () => {
    clearTimeout(boundsTimer);
    saveBounds();
  });
  current.on('maximize', () => {
    saveBounds();
    sendEvent(current.webContents, 'window.maximized', true);
  });
  current.on('unmaximize', () => {
    saveBounds();
    sendEvent(current.webContents, 'window.maximized', false);
  });

  // External links open in the system browser; the app itself never navigates away.
  current.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  current.webContents.on('will-navigate', (event) => event.preventDefault());

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devServerUrl) {
    void current.loadURL(devServerUrl);
  } else {
    void current.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

export function focusWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}

export const mainWindow = () => win;
export const setWindowState = (value: AppState) => {
  state = value;
};
