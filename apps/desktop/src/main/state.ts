// App state the shell needs: projects, open tabs, settings (AppDb, architecture.md 4).

import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { AppDb } from '@skaro/core';
import type { Locale, ProjectInfo, TabsState } from '../shared/ipc';

export class AppState {
  readonly db: AppDb;

  constructor(dbPath: string) {
    this.db = AppDb.open(dbPath);
    // No agent process survives a restart (agent-output.md 6).
    this.db.resetStaleRuntime();
  }

  listProjects(): ProjectInfo[] {
    return this.db
      .listProjects()
      .map((p) => ({ id: p.id, name: p.name, path: p.path, missing: !existsSync(p.path) }));
  }

  /** Registers a folder as a project; returns the existing one if already added. */
  addProject(path: string): ProjectInfo {
    const existing =
      this.db.findProjectByPath(path) ?? this.db.addProject({ name: basename(path) || path, path });
    this.db.touchProject(existing.id);
    return {
      id: existing.id,
      name: existing.name,
      path: existing.path,
      missing: !existsSync(existing.path),
    };
  }

  removeProject(id: string): void {
    this.db.removeProject(id);
  }

  getTabs(): TabsState {
    const known = new Set(this.db.listProjects().map((p) => p.id));
    const tabs = this.db.getOpenTabs().filter((t) => known.has(t.projectId));
    const active = tabs.find((t) => t.active)?.projectId;
    return { projects: tabs.map((t) => t.projectId), ...(active ? { active } : {}) };
  }

  setTabs(state: TabsState): void {
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
    return this.db.getSetting<unknown>(key, null);
  }

  setSetting(key: string, value: unknown): void {
    this.db.setSetting(key, value);
  }

  close(): void {
    this.db.close();
  }
}
