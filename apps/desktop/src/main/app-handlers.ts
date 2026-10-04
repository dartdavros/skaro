import { app, dialog, shell, type BrowserWindow } from 'electron';
import { PROJECT_DEFAULTS_KEY, type ExternalApp } from '../shared/ipc';
import {
  appDefaults,
  projectSettings,
  saveAppDefaults,
  saveProjectSettings,
} from './project-settings';
import { createFolder, inspectFolder, hasCode } from './new-project';
import { openEditor, openTerminal } from './external-apps';
import { projectCards } from './overview';
import { LOGO_EXTENSIONS, readLogo } from './project-logo';
import type { Updates } from './update-controller';
import type { Handlers } from './ipc';
import type { Services } from './app-services';
import { collectDiagnostics } from './diagnostics';

export function appHandlers(
  { appState, db, runs, projects, agents, chats, dataDir }: Services,
  updates: Updates,
  window: () => BrowserWindow | undefined,
  emit: (event: 'project.changed', payload: { projectId: string }) => void,
): Pick<
  Handlers,
  | 'window.minimize'
  | 'window.toggleMaximize'
  | 'window.close'
  | 'window.isMaximized'
  | 'app.getLocale'
  | 'app.setLocale'
  | 'app.getSetting'
  | 'app.setSetting'
  | 'app.projectDefaults'
  | 'app.setProjectDefaults'
  | 'app.version'
  | 'diagnostics.export'
  | 'app.checkUpdate'
  | 'updates.state'
  | 'updates.download'
  | 'updates.apply'
  | 'app.pickApp'
  | 'projects.list'
  | 'projects.pickFolder'
  | 'projects.inspect'
  | 'projects.defaultParent'
  | 'projects.add'
  | 'projects.create'
  | 'projects.remove'
  | 'projects.overview'
  | 'project.rename'
  | 'project.pickLogo'
  | 'project.removeLogo'
  | 'project.settings'
  | 'project.hasCode'
  | 'import.scan'
  | 'import.start'
  | 'import.review'
  | 'import.openSource'
  | 'project.saveSettings'
  | 'projects.relocate'
  | 'projects.openIn'
  | 'tabs.get'
  | 'tabs.set'
  | 'agents.list'
  | 'agents.refresh'
  | 'agents.install'
  | 'agents.login'
  | 'agents.models'
  | 'agents.config'
  | 'agents.openConfigDir'
  | 'agents.commands'
> {
  return {
    'window.minimize': () => window()?.minimize(),
    'window.toggleMaximize': () => {
      const win = window();
      return win?.isMaximized() ? win.unmaximize() : win?.maximize();
    },
    'window.close': () => window()?.close(),
    'window.isMaximized': () => window()?.isMaximized() ?? false,
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
    'app.version': () => updates.snapshot().current,
    'diagnostics.export': () =>
      collectDiagnostics(db, dataDir, {
        app: updates.snapshot().current,
        electron: process.versions.electron,
        node: process.versions.node,
      }),
    'app.checkUpdate': () => updates.check(),
    'updates.state': () => updates.snapshot(),
    'updates.download': () => updates.download(),
    'updates.apply': () => updates.apply(),
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
      const win = window();
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
      const win = window();
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
    'import.start': (projectId, paths, settings) => chats.startImport(projectId, paths, settings),
    'import.review': (projectId, chatId) => chats.importReview(projectId, chatId),
    'import.openSource': async (projectId, chatId, source) => {
      const path = await chats.openImportSource(projectId, chatId, source);
      const failed = await shell.openPath(path);
      if (failed) shell.showItemInFolder(path);
    },
    'project.saveSettings': async (projectId, settings) => {
      await saveProjectSettings(projects, projectId, settings, appState.getLocale(app.getLocale()));
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
  };
}
