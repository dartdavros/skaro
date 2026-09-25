import { app, BrowserWindow, dialog, net, protocol, screen, shell } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AttachmentStore } from '@skaro/core';
import { McpHttpServer, mergeTaskTool, type SkaroScope, type ToolResult } from '@skaro/mcp-server';
import type { EventName, Events, PickedFile } from '../shared/ipc';
import { AgentManager } from './agents';
import {
  existingPaths,
  isImagePath,
  readImage,
  resolveInside,
  suggestPaths,
  within,
} from './files';
import { registerHandlers, sendEvent } from './ipc';
import { createFolder, inspectFolder } from './new-project';
import { Projects } from './projects';
import { AppState } from './state';
import { TaskRuns } from './tasks';

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

interface Bounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

let win: BrowserWindow | undefined;
let state: AppState | undefined;

function emit<E extends EventName>(event: E, payload: Events[E]): void {
  if (win) sendEvent(win.webContents, event, payload);
}

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

function createMainWindow(): void {
  const bounds = savedBounds();
  const mac = process.platform === 'darwin';
  win = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Skaro',
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
  current.once('ready-to-show', () => {
    if (bounds.maximized) current.maximize();
    current.show();
  });

  const saveBounds = () => {
    if (current.isDestroyed() || current.isMinimized()) return;
    const b = current.getNormalBounds();
    state?.setSetting('window.bounds', { ...b, maximized: current.isMaximized() });
  };
  current.on('close', saveBounds);
  current.on('maximize', () => sendEvent(current.webContents, 'window.maximized', true));
  current.on('unmaximize', () => sendEvent(current.webContents, 'window.maximized', false));

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

function focusWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusWindow);

  void app.whenReady().then(async () => {
    const dataDir = app.getPath('userData');
    const appState = new AppState(join(dataDir, 'skaro.db'));
    state = appState;
    const db = appState.db;

    const attachments = new AttachmentStore(join(dataDir, 'attachments'));
    const projects = new Projects(db, (projectId) => emit('project.changed', { projectId }));
    const agents = new AgentManager({
      // Development and tests share one download of the agents.
      agentsDir: process.env['SKARO_AGENTS_DIR'] ?? join(dataDir, 'agents'),
      scratchDir: join(dataDir, 'scratch'),
      store: appState,
      openUrl: (url) => void shell.openExternal(url),
      onChange: (list) => emit('agents.changed', list),
    });
    const mcp = new McpHttpServer<SkaroScope>({
      name: 'skaro',
      version: app.getVersion(),
      tools: [
        // Tools are called only after the app is up, when `runs` exists.
        mergeTaskTool((args, scope): Promise<ToolResult> => runs.mergeTask(args, scope)),
      ],
    });
    await mcp.listen();
    const runs: TaskRuns = new TaskRuns(
      {
        db,
        dataDir,
        projects,
        agents,
        attachments,
        mcp,
        emit,
        locale: () => appState.getLocale(app.getLocale()),
      },
      Number(appState.getSetting('runs.slots')) || 3,
    );
    void agents.refresh();

    // Files the user attached may be shown even outside projects.
    const picked = new Set<string>();
    const imageAllowed = (abs: string) =>
      picked.has(abs) ||
      within(attachments.dir, abs) ||
      within(join(dataDir, 'worktrees'), abs) ||
      db.listProjects().some((p) => within(p.path, abs));

    protocol.handle('skaro-media', async (request) => {
      const url = new URL(request.url);
      if (url.hostname === 'attachment') {
        const [id, ext] = url.pathname.slice(1).split('.');
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext ?? 'png'}`;
        try {
          return await net.fetch(pathToFileURL(attachments.file({ id: id ?? '', mime })).href);
        } catch {
          return new Response(null, { status: 404 });
        }
      }
      if (url.hostname === 'file') {
        const image = await readImage(url.searchParams.get('path') ?? '', imageAllowed);
        if (!image) return new Response(null, { status: 404 });
        return new Response(new Uint8Array(image.bytes), {
          headers: { 'Content-Type': image.mime },
        });
      }
      return new Response(null, { status: 404 });
    });

    registerHandlers(
      {
        'window.minimize': () => win?.minimize(),
        'window.toggleMaximize': () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()),
        'window.close': () => win?.close(),
        'window.isMaximized': () => win?.isMaximized() ?? false,
        'app.getLocale': () => appState.getLocale(app.getLocale()),
        'app.setLocale': (locale) => appState.setLocale(locale),
        'app.getSetting': (key) => appState.getSetting(key),
        'app.setSetting': (key, value) => appState.setSetting(key, value),
        'projects.list': () => appState.listProjects(),
        'projects.pickFolder': async (defaultPath) => {
          const options: Electron.OpenDialogOptions = {
            properties: ['openDirectory', 'createDirectory'],
            ...(defaultPath ? { defaultPath } : {}),
          };
          const result = win
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);
          return result.canceled ? undefined : result.filePaths[0];
        },
        'projects.inspect': (path) => inspectFolder(path),
        'projects.defaultParent': () =>
          (appState.getSetting('projects.parent') as string | null) ?? app.getPath('home'),
        'projects.add': async (path) => {
          const folder = await inspectFolder(path);
          if (!folder.exists) throw new Error('folder not found');
          return appState.addProject(path);
        },
        'projects.create': async (parent, name) => {
          const path = await createFolder(parent, name);
          appState.setSetting('projects.parent', parent);
          return appState.addProject(path);
        },
        'projects.remove': (id) => appState.removeProject(id),
        'tabs.get': () => appState.getTabs(),
        'tabs.set': (tabs) => appState.setTabs(tabs),
        'agents.list': () => agents.list(),
        'agents.refresh': () => agents.refresh(),
        'agents.install': (agent) => agents.install(agent),
        'agents.login': (agent) => agents.login(agent),
        'agents.models': (agent, projectId) =>
          agents.listModels(agent, projects.get(projectId).root),
        'agents.commands': (agent, projectId) =>
          agents.listCommands(agent, projects.get(projectId).root),
        'tasks.list': (projectId) => runs.list(projectId),
        'task.open': (projectId, taskId) => runs.open(projectId, taskId),
        'task.send': (projectId, taskId, input) => runs.send(projectId, taskId, input),
        'task.respond': (projectId, taskId, id, answer) =>
          runs.respond(projectId, taskId, id, answer),
        'task.interrupt': (projectId, taskId) => runs.interrupt(projectId, taskId),
        'task.rewind': (projectId, taskId, itemId, resend) =>
          runs.rewind(projectId, taskId, itemId, resend),
        'task.stopBackground': (projectId, taskId, id) =>
          runs.stopBackground(projectId, taskId, id),
        'task.setSettings': (projectId, taskId, settings) =>
          runs.setSettings(projectId, taskId, settings),
        'task.merge': (projectId, taskId, id, action) => runs.merge(projectId, taskId, id, action),
        'task.toggleCriterion': (projectId, taskId, index) =>
          runs.toggleCriterion(projectId, taskId, index),
        'files.suggest': (projectId, taskId, query) =>
          suggestPaths(runs.workdir(projectId, taskId), query),
        'files.exist': (projectId, taskId, paths) =>
          existingPaths(runs.workdir(projectId, taskId), paths),
        'files.open': async (projectId, taskId, path) => {
          const error = await shell.openPath(resolveInside(runs.workdir(projectId, taskId), path));
          if (error) throw new Error(error);
        },
        'files.pick': async (kind) => {
          const options: Electron.OpenDialogOptions = {
            properties: kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
            ...(kind === 'images'
              ? {
                  filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
                }
              : {}),
          };
          const result = win
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);
          if (result.canceled) return [];
          return result.filePaths.map((path): PickedFile => {
            if (kind === 'folder') return { path, kind: 'folder' };
            if (isImagePath(path)) {
              picked.add(path);
              return { path, kind: 'image' };
            }
            return { path, kind: 'file' };
          });
        },
        'shell.openExternal': async (url) => {
          if (!/^https?:\/\//.test(url)) throw new Error('only web links open externally');
          await shell.openExternal(url);
        },
      },
      (sender) => sender === win?.webContents,
    );

    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });

    let quitting = false;
    app.on('before-quit', (event) => {
      if (quitting) return;
      quitting = true;
      event.preventDefault();
      // Agent processes and the MCP server stop before the app does.
      void Promise.allSettled([runs.close(), mcp.close()]).then(() => {
        projects.close();
        app.quit();
      });
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => state?.close());
}
