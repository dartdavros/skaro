import { DbTable } from './table.ts';
import type { ProjectRecord } from './model.ts';
import { type Row, toProject } from './rows.ts';
import { randomUUID } from 'node:crypto';

export class DbProjects extends DbTable {
  // ── projects and tabs ────────────────────────────────────────────────────

  addProject(input: { name: string; path: string }): ProjectRecord {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)')
      .run(id, input.name, input.path, this.now());
    return this.getProject(id)!;
  }

  getProject(id: string): ProjectRecord | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
    return row && toProject(row);
  }

  findProjectByPath(path: string): ProjectRecord | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as
      Row | undefined;
    return row && toProject(row);
  }

  /** Most recently opened first. */
  listProjects(): ProjectRecord[] {
    return (
      this.db
        .prepare('SELECT * FROM projects ORDER BY COALESCE(last_opened_at, created_at) DESC')
        .all() as Row[]
    ).map(toProject);
  }

  touchProject(id: string): void {
    this.db.prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run(this.now(), id);
  }

  renameProject(id: string, name: string): void {
    this.db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, id);
  }

  /** A data: URL, or undefined to go back to the initials. */
  setProjectLogo(id: string, logo: string | undefined): void {
    this.db.prepare('UPDATE projects SET logo = ? WHERE id = ?').run(logo ?? null, id);
  }

  /** The project folder moved: "Найти заново". */
  moveProject(id: string, path: string): void {
    this.db.prepare('UPDATE projects SET path = ? WHERE id = ?').run(path, id);
  }

  /** Forgets the project in Skaro; files on disk are untouched. */
  removeProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  getOpenTabs(): { projectId: string; active: boolean }[] {
    return (
      this.db.prepare('SELECT project_id, active FROM open_tabs ORDER BY position').all() as Row[]
    ).map((r) => ({
      projectId: String(r['project_id']),
      active: r['active'] === 1,
    }));
  }

  setOpenTabs(projectIds: string[], activeId?: string): void {
    this.transaction(() => {
      this.db.exec('DELETE FROM open_tabs');
      const insert = this.db.prepare(
        'INSERT INTO open_tabs (project_id, position, active) VALUES (?, ?, ?)',
      );
      projectIds.forEach((id, i) => insert.run(id, i, id === activeId ? 1 : 0));
    });
  }
}
