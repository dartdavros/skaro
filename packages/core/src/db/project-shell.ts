import { DbTable } from './table.ts';
import { toProject, type Row } from './rows.ts';
import type { ProjectRecord } from './model.ts';
export type ProjectShellRecord = Omit<ProjectRecord, 'logo'> & { logoVersion?: number };
function shellRecord(row: Row): ProjectShellRecord {
  return {
    ...toProject(row),
    ...(row['logo_version'] !== null && row['logo_version'] !== undefined
      ? { logoVersion: Number(row['logo_version']) }
      : {}),
  };
}

/** The first frame reads names and references; logo bytes load only when an image is visible. */
export class DbProjectShell extends DbTable {
  private scope?: string;
  get projectScope() {
    return this.scope;
  }
  /** Narrow a real registry for a verification session before any project services start. */
  scopeTo(projectId: string) {
    if (!projectId || (this.scope && this.scope !== projectId))
      throw new Error('Project registry scope cannot change');
    if (!this.get(projectId)) throw new Error('Verification project is not registered');
    this.scope = projectId;
  }
  private fields = `id,name,path,created_at,last_opened_at,
    CASE WHEN logo IS NOT NULL THEN COALESCE((SELECT value FROM settings WHERE key='ui.logo.' || projects.id),'0') END AS logo_version`;
  version(): number {
    return Number(
      this.db.prepare("SELECT value FROM settings WHERE key='ui.projects.revision'").get()?.[
        'value'
      ] ?? 0,
    );
  }
  list(limit?: number) {
    if (this.scope) return limit === 0 ? [] : [this.get(this.scope)!];
    const sql = `SELECT ${this.fields} FROM projects ORDER BY COALESCE(last_opened_at,created_at) DESC`;
    const rows =
      limit === undefined
        ? this.db.prepare(sql).all()
        : this.db.prepare(`${sql} LIMIT ?`).all(limit);
    return (rows as Row[]).map(shellRecord);
  }
  page(after = '', limit = 32): ProjectShellRecord[] {
    if (this.scope) return this.scope > after && limit > 0 ? [this.get(this.scope)!] : [];
    return (
      this.db
        .prepare(`SELECT ${this.fields} FROM projects WHERE id>? ORDER BY id LIMIT ?`)
        .all(after, limit) as Row[]
    ).map(shellRecord);
  }
  initial(limit = 32) {
    if (this.scope) return limit > 0 ? [this.get(this.scope)!] : [];
    const value = this.db
      .prepare("SELECT value FROM settings WHERE key='ui.projects.initial'")
      .get();
    const ids = value ? (JSON.parse(String(value['value'])) as string[]) : [];
    let first = ids.slice(0, limit).flatMap((id) => {
      const project = this.get(id);
      return project ? [project] : [];
    });
    if (!first.length)
      first = (
        this.db.prepare(`SELECT ${this.fields} FROM projects LIMIT ?`).all(limit) as Row[]
      ).map(shellRecord);
    const tabs = this.db
      .prepare(`SELECT ${this.fields} FROM projects WHERE id IN (SELECT project_id FROM open_tabs)`)
      .all() as Row[];
    const seen = new Set(first.map((project) => project.id));
    return [...first, ...tabs.filter((row) => !seen.has(String(row['id']))).map(shellRecord)];
  }
  get(id: string) {
    if (this.scope && id !== this.scope) return undefined;
    const row = this.db.prepare(`SELECT ${this.fields} FROM projects WHERE id=?`).get(id) as
      Row | undefined;
    return row ? shellRecord(row) : undefined;
  }
  activity(projectId: string): number {
    if (this.scope && projectId !== this.scope)
      throw new Error('Project is outside verification scope');
    const row = this.db
      .prepare(
        `SELECT MAX(at) AS at FROM (
      SELECT MAX(COALESCE(ended_at,started_at)) AS at FROM runs WHERE project_id=? AND retired_at IS NULL
      UNION ALL SELECT MAX(updated_at) AS at FROM chats WHERE project_id=?)`,
      )
      .get(projectId, projectId);
    return Number(row?.['at'] ?? 0);
  }
  runAgent(projectId: string, taskId: string): { agent: string; model?: string } | undefined {
    if (this.scope && projectId !== this.scope)
      throw new Error('Project is outside verification scope');
    const row = this.db
      .prepare(
        `SELECT agent,model FROM runs WHERE project_id=? AND task_id=? AND retired_at IS NULL
      ORDER BY started_at DESC LIMIT 1`,
      )
      .get(projectId, taskId);
    return row
      ? { agent: String(row['agent']), ...(row['model'] ? { model: String(row['model']) } : {}) }
      : undefined;
  }
  logo(id: string): string | undefined {
    if (this.scope && id !== this.scope) return undefined;
    const row = this.db.prepare('SELECT logo FROM projects WHERE id=?').get(id);
    return row?.['logo'] ? String(row['logo']) : undefined;
  }
  tabs() {
    if (this.scope) return [{ projectId: this.scope, active: true }];
    return this.db
      .prepare(
        `SELECT t.project_id,t.active FROM open_tabs t
      JOIN projects p ON p.id=t.project_id ORDER BY t.position`,
      )
      .all()
      .map((row) => ({ projectId: String(row['project_id']), active: row['active'] === 1 }));
  }
}
