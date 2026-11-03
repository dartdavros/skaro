// App state the shell needs: projects, open tabs, settings (AppDb, architecture.md 4).

import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { AppDb, type ProjectRecord } from '@skaro/core';
import { cachedSession } from './session-cache';
import { startupChatCatalog } from './startup-chat-catalog';
import type { ChatCatalog } from '../shared/chat-catalog';
import { cachedProjectCards } from './project-card-cache';
import { logoReference } from './project-logo-reference';
import type { BootstrapState, Locale, ProjectInfo, TabsState } from '../shared/ipc';

export class AppState {
  readonly db: AppDb;
  private readonly sessionSettings = new Map<string, unknown>();
  /** Main services supply current liveness on renderer reload without restoring any history. */
  chatCatalogOverlay?: (page: ChatCatalog) => ChatCatalog;

  constructor(dbPath: string, projectScope?: string) {
    this.db = AppDb.open(dbPath);
    try {
      if (projectScope) {
        this.db.shell.scopeTo(projectScope);
        if (this.db.shell.get(projectScope)?.name.toLowerCase() !== 'cat-pilot')
          throw new Error('Live verification is restricted to the registered Cat-pilot');
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
    // No agent process survives a restart (agent-output.md 6).
    this.db.resetStaleRuntime(projectScope);
    if (projectScope) {
      this.sessionSettings.set('ui.workspace', {
        view: 'settings',
        sections: {},
        openTasks: {},
        openChats: {},
      });
      this.sessionSettings.set('settings.section', 'agents');
    }
  }

  listProjects(): ProjectInfo[] {
    return this.db.shell.list().map(info);
  }

  bootstrap(systemLocale = 'en'): BootstrapState {
    const projects = this.db.shell.initial().map((p) => ({
      id: p.id,
      name: p.name,
      path: p.path,
      missing: false,
      ...(logoReference(p) ? { logo: logoReference(p) } : {}),
    }));
    const workspace = this.getSetting('ui.workspace') as
      import('../shared/ipc-sessions').WorkspaceState | undefined;
    const tabs = this.getTabs();
    const catalog = startupChatCatalog(this.db.filePath, workspace, tabs);
    return {
      chatCatalog: catalog ? (this.chatCatalogOverlay?.(catalog) ?? catalog) : undefined,
      sessions: cachedSession(this.db.filePath, workspace, tabs),
      projects,
      projectsView: this.db.getSetting('ui.projects', undefined),
      tabs,
      locale: this.getLocale(systemLocale),
      workspace,
      cards: cachedProjectCards(
        this.db.filePath,
        projects.map((project) => project.id),
      ).map((card) => ({ ...card, ...projects.find((project) => project.id === card.id)! })),
      feedFont: this.db.getSetting('ui.feedFont', undefined),
      panelCollapsed: this.db.getSetting('ui.navCollapsed', false),
    };
  }

  /** Registers a folder as a project; returns the existing one if already added. */
  addProject(path: string): ProjectInfo {
    if (this.db.shell.projectScope) throw new Error('Verification cannot register another project');
    const existing =
      this.db.findProjectByPath(path) ?? this.db.addProject({ name: basename(path) || path, path });
    this.db.touchProject(existing.id);
    return info(existing);
  }

  /** "Найти заново": the same project, now in `path`. */
  relocateProject(id: string, path: string): ProjectInfo {
    this.project(id);
    const project = this.db.getProject(id);
    if (!project) throw new Error('unknown project');
    this.db.moveProject(id, path);
    return info({ ...project, path });
  }

  /** The name shown in Skaro; an empty one keeps the old name. */
  renameProject(id: string, name: string): ProjectInfo {
    this.project(id);
    const trimmed = name.trim();
    if (trimmed) this.db.renameProject(id, trimmed);
    return this.project(id);
  }

  setProjectLogo(id: string, logo: string | undefined): ProjectInfo {
    this.project(id);
    this.db.setProjectLogo(id, logo);
    return this.project(id);
  }

  project(id: string): ProjectInfo {
    const project = this.db.shell.get(id);
    if (!project) throw new Error('unknown project');
    return info(project);
  }

  removeProject(id: string): void {
    this.project(id);
    this.db.removeProject(id);
  }

  getTabs(): TabsState {
    const tabs = this.db.shell.tabs();
    const active = tabs.find((t) => t.active)?.projectId;
    return { projects: tabs.map((t) => t.projectId), ...(active ? { active } : {}) };
  }

  setTabs(state: TabsState): void {
    if (this.db.shell.projectScope) {
      if (state.projects.some((id) => id !== this.db.shell.projectScope))
        throw new Error('Project is outside verification scope');
      return;
    }
    this.db.setOpenTabs(state.projects, state.active);
    if (state.active) this.db.touchProject(state.active);
  }

  getLocale(systemLocale: string): Locale {
    const saved = this.db.getSetting<Locale | null>('ui.locale', null);
    if (saved === 'ru' || saved === 'en') return saved;
    return systemLocale.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  }

  setLocale(locale: Locale): void {
    this.db.setSetting('ui.locale', locale);
  }

  getSetting(key: string): unknown {
    if (this.sessionSettings.has(key)) return this.sessionSettings.get(key);
    return this.db.getSetting<unknown>(key, null);
  }

  setSetting(key: string, value: unknown): void {
    if (key.startsWith('builtin.'))
      throw new Error('Builtin configuration requires its validated host API');
    if (
      this.db.shell.projectScope &&
      (key.startsWith('ui.') || key.startsWith('settings.') || key.startsWith('window.'))
    ) {
      this.sessionSettings.set(key, value);
      return;
    }
    this.db.setSetting(key, value);
  }

  close(): void {
    this.db.close();
  }
}

function info(p: ProjectRecord & { logoVersion?: number }): ProjectInfo {
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    missing: !existsSync(p.path),
    ...(logoReference(p) ? { logo: logoReference(p) } : {}),
  };
}
