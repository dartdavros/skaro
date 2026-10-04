import { app, BrowserWindow, protocol } from 'electron';
import { join } from 'node:path';
import type { EventName, Events } from '../shared/ipc';
import { registerHandlers, sendEvent } from './ipc';
import { AppState } from './state';
import { createServices } from './app-services';
import { createMainWindow, focusWindow, mainWindow, setWindowState } from './app-window';
import { registerMedia } from './app-media';
import { appHandlers } from './app-handlers';
import { sessionHandlers } from './session-handlers';
import { fileHandlers } from './file-handlers';
import { createUpdates } from './update-service';
import type { UpdateActivity } from './update-activity';
import { trace } from './trace';
trace(`main loaded, pid ${process.pid}`);
// Tests run against their own data dir.
if (process.env['SKARO_USER_DATA']) {
  app.setPath('userData', process.env['SKARO_USER_DATA']);
  // An unsigned test build asking the macOS keychain for access blocks a headless runner.
  if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
}
app.setName('Skaro');

// Images in the feed: attachments and project images, never arbitrary files.
protocol.registerSchemesAsPrivileged([
  { scheme: 'skaro-media', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let state: AppState | undefined;
let updateActivity: UpdateActivity | undefined;
function emit<E extends EventName>(event: E, payload: Events[E]): void {
  updateActivity?.observe(event, payload);
  const window = mainWindow();
  if (window) sendEvent(window.webContents, event, payload);
}
const locked = app.requestSingleInstanceLock();
trace(`single instance lock: ${locked}`);
if (!locked) {
  app.quit();
} else {
  app.on('second-instance', focusWindow);
  app.on('will-finish-launching', () => trace('will finish launching'));
  app.on('child-process-gone', (_e, details) =>
    trace(`child process gone: ${details.type} ${details.reason}`),
  );

  void app.whenReady().then(async () => {
    trace('app ready');
    const dataDir = app.getPath('userData');
    const appState = new AppState(join(dataDir, 'skaro.db'));
    state = appState;
    setWindowState(appState);
    const services = await createServices(appState, dataDir, emit);
    const { runs, chats, mcp, projects } = services;
    const result = await createUpdates({ ...services, emit });
    updateActivity = result.activity;
    const updates = result.updates;
    if (updates.canRunAgents()) void services.agents.refresh();
    const picked = new Set<string>();
    registerMedia(services, picked);
    registerHandlers(
      {
        ...appHandlers(services, updates, mainWindow, emit),
        ...sessionHandlers(services),
        ...fileHandlers(services, mainWindow, picked),
      },
      (sender) => sender === mainWindow()?.webContents,
      (method, action) => result.activity.invoke(method, action),
    );
    updates.start();
    trace('handlers registered');

    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });

    let quitting = false;
    app.on('before-quit', (event) => {
      if (quitting) return;
      quitting = true;
      trace('before quit');
      updates.stop();
      event.preventDefault();
      // Agent processes and the MCP server stop before the app does.
      void Promise.allSettled([runs.close(), chats.close(), mcp.close()]).then(() => {
        trace('runs and mcp server closed');
        projects.close();
        app.quit();
      });
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    trace('will quit');
    state?.close();
  });
  app.on('quit', (_e, code) => trace(`quit, exit code ${code}`));
}
