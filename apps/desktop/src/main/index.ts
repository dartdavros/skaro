import { OwnerCommands } from './owner-commands';
import { app, BrowserWindow, protocol } from 'electron';
import { join } from 'node:path';
import type { EventName, Events } from '../shared/ipc';
import { registerHandlers, sendEvent, type Handlers } from './ipc';
import { AppState } from './state';
import {
  createMainWindow,
  focusWindow,
  mainWindow,
  setWindowState,
  setWindowLifecycle,
} from './app-window';
import { AppLifecycle } from './app-lifecycle';
import { AppTray } from './app-tray';
import { agentActivity, type AgentActivity } from './app-agent-activity';
import { shutdownApp } from './app-shutdown';
import { CLOSE_TO_TRAY_SETTING, CLOSE_TO_TRAY_DEFAULT } from '../shared/app-shell';
import { registerMedia } from './app-media';
import { appHandlers } from './app-handlers';
import { sessionHandlers } from './session-handlers';
import { fileHandlers } from './file-handlers';
import { createUpdates } from './update-service';
import type { UpdateActivity } from './update-activity';
import { trace } from './trace';
import { HistoryReads, setHistoryReads } from './history-read-service';
import { registerProjectLogos } from './app-logo';
import { graphHandlers } from './graph/handlers';
import { keepLoopbackDirect } from './loopback-proxy';
trace(`main loaded, pid ${process.pid}`);
keepLoopbackDirect();
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
  { scheme: 'skaro-logo', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let state: AppState | undefined;
let historyReads: HistoryReads | undefined;
let updateActivity: UpdateActivity | undefined;
let overview: import('./project-overview').ProjectOverview | undefined;
let taskRuns: import('./tasks').TaskRuns | undefined;
let graph: import('./graph/service').GraphService | undefined;
let tray: AppTray | undefined;
function emit<E extends EventName>(event: E, payload: Events[E]): void {
  historyReads?.observe(event, payload);
  updateActivity?.observe(event, payload);
  overview?.observe(event, payload);
  if (
    ['task.changed', 'chat.events', 'chats.changed', 'updates.changed', 'command.changed'].includes(
      event,
    )
  )
    tray?.schedule();
  if (event === 'project.changed')
    void graph?.rebuild((payload as Events['project.changed']).projectId).catch(() => undefined);
  if (event === 'project.changed' || event === 'task.changed')
    taskRuns?.projectChanged((payload as { projectId: string }).projectId);
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
    trace('opening app state');
    const appState = new AppState(join(dataDir, 'skaro.db'));
    trace('app state ready');
    state = appState;
    registerProjectLogos(appState);
    historyReads = new HistoryReads(dataDir, emit);
    setHistoryReads(historyReads);
    setWindowState(appState);
    let resolveHandlers!: (handlers: Handlers) => void;
    let rejectHandlers!: (error: unknown) => void;
    const ready = new Promise<Handlers>((resolve, reject) => {
      resolveHandlers = resolve;
      rejectHandlers = reject;
    });
    let activity = (): AgentActivity => ({ working: 0, waiting: 0, busy: false });
    let shutdown = async () => {};
    let hasUpdate = () => false;
    const lifecycle = new AppLifecycle({
      closeToTray: () =>
        (appState.getSetting(CLOSE_TO_TRAY_SETTING) ?? CLOSE_TO_TRAY_DEFAULT) !== false &&
        !!tray?.available(),
      busy: () => activity().busy || appState.db.commands.pending().length > 0,
      locale: () => appState.getLocale(app.getLocale()),
      shutdown: async () => {
        await ready.catch(() => undefined);
        await shutdown();
      },
    });
    setWindowLifecycle(lifecycle);
    try {
      tray = new AppTray({
        locale: () => appState.getLocale(app.getLocale()),
        activity: () => activity(),
        updateAvailable: () => hasUpdate(),
      });
    } catch (error) {
      console.error('System tray:', error);
    }
    registerHandlers(
      new Proxy({} as Handlers, {
        get:
          (_target, method: string) =>
          (...args: unknown[]) => {
            if (lifecycle.stopping()) throw new Error('Application is quitting');
            return ready.then((handlers) => {
              const handler = handlers[method as keyof Handlers] as (
                ...values: unknown[]
              ) => unknown;
              return handler(...args);
            });
          },
      }),
      (sender) => sender === mainWindow()?.webContents,
    );
    createMainWindow();
    // Services and the renderer are independent: history requests must not wait for first paint.
    const { createServices } = await import('./app-services');
    const services = await createServices(appState, dataDir, emit).catch((error: unknown) => {
      rejectHandlers(error);
      throw error;
    });
    const { runs, chats } = services;
    activity = () => agentActivity(appState.db, runs, chats);
    appState.chatCatalogOverlay = (page) => chats.liveRows(page);
    overview = services.overview;
    graph = services.graph;
    taskRuns = services.runs;
    const result = await createUpdates({ ...services, emit });
    updateActivity = result.activity;
    const updates = result.updates;
    hasUpdate = () => updates.snapshot().components.length > 0;
    if (updates.canRunAgents()) void services.agents.refresh();
    const picked = new Set<string>();
    registerMedia(services, picked);
    const commands = new OwnerCommands(appState.db, (command) => emit('command.changed', command));
    shutdown = () => shutdownApp(services, commands, updates, historyReads!);
    const handlers = {
      ...appHandlers(services, updates, mainWindow, emit, () => tray?.refresh()),
      ...sessionHandlers(services),
      ...fileHandlers(services, mainWindow, picked),
      ...graphHandlers(services.graph),
    };
    commands.start(handlers);
    const acceptedHandlers = {
      ...handlers,
      'chat.send': (project: string, owner: string, input: import('../shared/ipc').MessageInput) =>
        commands.accept('chat.send', project, owner, input),
      'task.send': (project: string, owner: string, input: import('../shared/ipc').MessageInput) =>
        commands.accept('task.send', project, owner, input),
    };
    resolveHandlers(
      new Proxy(acceptedHandlers, {
        get: (target, method: keyof Handlers) => {
          if (!Object.hasOwn(target, method)) return undefined;
          return (...args: unknown[]) =>
            result.activity.invoke(method, () => {
              const handler = target[method] as (...values: unknown[]) => unknown;
              return handler(...args);
            });
        },
      }),
    );
    updates.start();
    tray?.refresh();
    trace('handlers registered');

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
      else focusWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    trace('will quit');
    tray?.destroy();
    state?.close();
  });
  app.on('quit', (_e, code) => trace(`quit, exit code ${code}`));
}
