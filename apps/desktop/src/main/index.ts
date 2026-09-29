import { app, BrowserWindow, dialog, net, protocol, screen, shell } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AttachmentStore } from '@skaro/core';
import {
  McpHttpServer,
  mergeTaskTool,
  submitResultTool,
  projectTools,
  type SkaroScope,
  type ToolResult,
} from '@skaro/mcp-server';
import {
  PROJECT_DEFAULTS_KEY,
  type EventName,
  type Events,
  type ExternalApp,
  type PickedFile,
} from '../shared/ipc';
import { AgentManager } from './agents';
import { ChatSessions } from './chats';
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
import { openEditor, openTerminal } from './external-apps';
import { Notifier } from './notifier';
import { hasCode } from './new-project';
import { projectCards } from './overview';
import { LOGO_EXTENSIONS, readLogo } from './project-logo';
import { checkUpdate } from './updates';
import { Docs } from './docs';
import { Plan } from './plan';
import {
  appDefaults,
  projectSettings,
  saveAppDefaults,
  saveProjectSettings,
} from './project-settings';
import { Projects } from './projects';
import { AppState } from './state';
import { TaskBoard } from './task-board';
import { TaskRuns } from './tasks';

/** Startup and shutdown milestones on stdout, for slow launches on CI runners. */
const trace = process.env['SKARO_TRACE']
  ? (step: string) => console.log(`[trace ${process.uptime().toFixed(2)}s] ${step}`)
  : () => {};
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
  trace('bounds read');
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

function focusWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
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
      locale: () => appState.getLocale(app.getLocale()),
    });
    const mcp = new McpHttpServer<SkaroScope>({
      name: 'skaro',
      version: app.getVersion(),
      tools: [
        // Tools are called only after the app is up, when `runs` exists.
        mergeTaskTool((args, scope): Promise<ToolResult> => runs.mergeTask(args, scope)),
        submitResultTool((args, scope): Promise<ToolResult> => runs.submitResult(args, scope)),
        ...projectTools({
          context: (scope) => chats.context(scope),
          writeDoc: (args, scope) => chats.writeDoc(args, scope),
          proposeAdr: (args, scope) => chats.proposeAdr(args, scope),
          proposeSpec: (args, scope) => chats.proposeSpec(args, scope),
          stageArtifact: (args, scope) => chats.stageArtifact(args, scope),
          finishImport: (args, scope) => chats.finishImport(args, scope),
          proposeMilestones: (args, scope) => chats.proposeMilestones(args, scope),
          proposeTasks: (args, scope) => chats.proposeTasks(args, scope),
          updateTask: (args, scope) => chats.updateTask(args, scope),
        }),
      ],
    });
    await mcp.listen();
    trace('mcp server listening');
    const notifier = new Notifier({
      setting: (key) => appState.getSetting(key),
      locale: () => appState.getLocale(app.getLocale()),
    });
    const runs: TaskRuns = new TaskRuns(
      {
        notify: (kind, text) => notifier.notify(kind, text),
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
    const board = new TaskBoard({
      projects,
      runs,
      emit,
      event: (projectId, kind, data) => db.addEvent(projectId, kind, data),
    });
    const docs = new Docs({ projects, emit, reveal: (path) => shell.showItemInFolder(path) });
    const plan = new Plan({ projects, emit, locale: () => appState.getLocale(app.getLocale()) });
    const chats: ChatSessions = new ChatSessions({
      db,
      dataDir,
      projects,
      agents,
      attachments,
      mcp,
      emit,
      locale: () => appState.getLocale(app.getLocale()),
    });
    void agents.refresh();
    trace('task runs created');

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
        'app.setSetting': (key, value) => {
          appState.setSetting(key, value);
          if (key === 'runs.slots' && typeof value === 'number') runs.setSlots(value);
        },
        'app.projectDefaults': () => appDefaults(projects),
        'app.setProjectDefaults': (next) =>
          saveAppDefaults(
            projects,
            db.listProjects().map((p) => p.id),
            next,
            (value) => appState.setSetting(PROJECT_DEFAULTS_KEY, value),
            appState.getLocale(app.getLocale()),
          ),
        'app.version': () => app.getVersion(),
        'app.checkUpdate': () => checkUpdate(app.getVersion()),
        'app.pickApp': async () => {
          const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            ...(process.platform === 'darwin' ? { defaultPath: '/Applications' } : {}),
          });
          return result.canceled ? undefined : result.filePaths[0];
        },
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
        'projects.overview': () => projectCards(db, projects),
        'project.rename': (projectId, name) => appState.renameProject(projectId, name),
        'project.pickLogo': async (projectId) => {
          const options: Electron.OpenDialogOptions = {
            properties: ['openFile'],
            filters: [{ name: 'SVG, PNG, JPG', extensions: LOGO_EXTENSIONS }],
          };
          const result = win
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);
          const path = result.canceled ? undefined : result.filePaths[0];
          return path ? appState.setProjectLogo(projectId, await readLogo(path)) : undefined;
        },
        'project.removeLogo': (projectId) => appState.setProjectLogo(projectId, undefined),
        'project.settings': (projectId) => projectSettings(projects, projectId),
        'project.hasCode': (projectId) => hasCode(projects.get(projectId).root),
        'import.scan': (paths) => chats.scanImport(paths),
        'import.start': (projectId, paths, settings) =>
          chats.startImport(projectId, paths, settings),
        'import.review': (projectId, chatId) => chats.importReview(projectId, chatId),
        'import.openSource': async (projectId, chatId, source) => {
          const path = await chats.openImportSource(projectId, chatId, source);
          const failed = await shell.openPath(path);
          if (failed) shell.showItemInFolder(path);
        },
        'project.saveSettings': async (projectId, settings) => {
          await saveProjectSettings(
            projects,
            projectId,
            settings,
            appState.getLocale(app.getLocale()),
          );
          emit('project.changed', { projectId });
        },
        'projects.relocate': async (id, path) => {
          const folder = await inspectFolder(path);
          if (!folder.exists) throw new Error('folder not found');
          const project = appState.relocateProject(id, path);
          projects.forget(id);
          return project;
        },
        'projects.openIn': async (id, target) => {
          const project = db.getProject(id);
          if (!project) throw new Error('unknown project');
          if (target === 'explorer') {
            const error = await shell.openPath(project.path);
            if (error) throw new Error(error);
            return;
          }
          const choice = appState.getSetting(`apps.${target}`) as ExternalApp | null;
          if (target === 'editor') await openEditor(project.path, choice);
          else await openTerminal(project.path, choice);
        },
        'tabs.get': () => appState.getTabs(),
        'tabs.set': (tabs) => appState.setTabs(tabs),
        'agents.list': () => agents.list(),
        'agents.refresh': () => agents.refresh(),
        'agents.install': (agent) => agents.install(agent),
        'agents.login': (agent) => agents.login(agent),
        // Without a project (Settings → Agents) the agent lists models from the home folder.
        'agents.models': (agent, projectId) =>
          agents.listModels(agent, projectId ? projects.get(projectId).root : app.getPath('home')),
        'agents.config': (agent) => agents.userConfig(agent, app.getPath('home')),
        'agents.openConfigDir': async (agent) => {
          const error = await shell.openPath(agents.configDir(agent));
          if (error) throw new Error(error);
        },
        'agents.commands': (agent, projectId) =>
          agents.listCommands(agent, projects.get(projectId).root),
        'tasks.list': (projectId) => runs.list(projectId),
        'tasks.slots': () => runs.slots(),
        'tasks.run': (projectId, ids, message, assignment) =>
          runs.launch(projectId, ids, message, assignment),
        'tasks.archive': (projectId, ids, archived) => board.archive(projectId, ids, archived),
        'tasks.delete': (projectId, ids) => board.delete(projectId, ids),
        'tasks.move': (projectId, ids, milestone) => board.move(projectId, ids, milestone),
        'tasks.unblock': (projectId, ids) => board.unblock(projectId, ids),
        'tasks.assign': async (projectId, ids, assignment) => {
          for (const id of ids) await runs.assign(projectId, id, assignment);
        },
        'docs.list': (projectId) => docs.list(projectId),
        'docs.read': (projectId, path) => docs.read(projectId, path),
        'docs.write': (projectId, path, text) => docs.write(projectId, path, text),
        'docs.create': (projectId, name) => docs.create(projectId, name),
        'docs.createSpec': (projectId, title) => docs.createSpec(projectId, title),
        'docs.setAdrStatus': (projectId, id, status) => docs.setAdrStatus(projectId, id, status),
        'docs.setSpecStatus': (projectId, id, status) => docs.setSpecStatus(projectId, id, status),
        'docs.reveal': (projectId, path) => docs.reveal(projectId, path),
        'plan.milestones': (projectId) => plan.milestones(projectId),
        'plan.create': (projectId, input) => plan.create(projectId, input),
        'plan.update': (projectId, id, input) => plan.update(projectId, id, input),
        'plan.delete': (projectId, id) => plan.delete(projectId, id),
        'plan.reorder': (projectId, ids) => plan.reorder(projectId, ids),
        'plan.placeTask': (projectId, taskId, milestoneId, index) =>
          plan.placeTask(projectId, taskId, milestoneId, index),
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
        'chats.list': (projectId) => chats.list(projectId),
        'chats.defaults': (projectId) => chats.defaults(projectId),
        'chat.open': (projectId, chatId) => chats.open(projectId, chatId),
        'chat.create': (projectId, settings, input) => chats.create(projectId, settings, input),
        'chat.send': (projectId, chatId, input) => chats.send(projectId, chatId, input),
        'chat.respond': (projectId, chatId, id, answer) =>
          chats.respond(projectId, chatId, id, answer),
        'chat.interrupt': (projectId, chatId) => chats.interrupt(projectId, chatId),
        'chat.rewind': (projectId, chatId, itemId, resend) =>
          chats.rewind(projectId, chatId, itemId, resend),
        'chat.setSettings': (projectId, chatId, settings) =>
          chats.setSettings(projectId, chatId, settings),
        'chat.archive': (projectId, chatId, archived) => chats.archive(projectId, chatId, archived),
        'chat.proposal': (projectId, chatId, itemId, action) =>
          chats.proposal(projectId, chatId, itemId, action),
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
