// Public application database API; persistence is composed by table responsibility.
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations.ts';
import { DbTable } from './table.ts';
export type * from './model.ts';
import type {
  ProjectRecord,
  RunOutcome,
  RunRecord,
  ChatRecord,
  MergeRecord,
  EventRecord,
  InteractionRecord,
} from './model.ts';
import type { TaskRuntime } from '../status.ts';
import { DbProjects } from './projects.ts';
import { DbSettings } from './settings.ts';
import { DbRuntime } from './runtime.ts';
import { DbRuns } from './runs.ts';
import { DbChats } from './chats.ts';
import { DbMerges } from './merges.ts';
import { DbEvents } from './events.ts';
import { DbInteractions } from './interactions.ts';

export class AppDb extends DbTable {
  private readonly projects: DbProjects;
  private readonly settings: DbSettings;
  private readonly runtime: DbRuntime;
  private readonly runs: DbRuns;
  private readonly chats: DbChats;
  private readonly merges: DbMerges;
  private readonly events: DbEvents;
  private readonly interactions: DbInteractions;

  private constructor(db: DatabaseSync, now: () => number) {
    super(db, now);
    this.projects = new DbProjects(db, now);
    this.settings = new DbSettings(db, now);
    this.runtime = new DbRuntime(db, now);
    this.runs = new DbRuns(db, now);
    this.chats = new DbChats(db, now);
    this.merges = new DbMerges(db, now);
    this.events = new DbEvents(db, now);
    this.interactions = new DbInteractions(db, now);
  }

  /** Opens (and migrates) the database; `:memory:` for tests. */
  static open(path: string, now: () => number = Date.now): AppDb {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    const version = Number(
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    );
    for (let v = version; v < MIGRATIONS.length; v++) {
      db.exec('BEGIN');
      try {
        db.exec(MIGRATIONS[v]!);
        db.exec(`PRAGMA user_version = ${v + 1}`);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
    return new AppDb(db, now);
  }

  close(): void {
    this.db.close();
  }

  get schemaVersion(): number {
    return Number(
      (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    );
  }

  // ── projects and tabs ────────────────────────────────────────────────────

  addProject(input: { name: string; path: string }): ProjectRecord {
    return this.projects.addProject(input);
  }

  getProject(id: string): ProjectRecord | undefined {
    return this.projects.getProject(id);
  }

  findProjectByPath(path: string): ProjectRecord | undefined {
    return this.projects.findProjectByPath(path);
  }

  /** Most recently opened first. */
  listProjects(): ProjectRecord[] {
    return this.projects.listProjects();
  }

  touchProject(id: string): void {
    return this.projects.touchProject(id);
  }

  renameProject(id: string, name: string): void {
    return this.projects.renameProject(id, name);
  }

  /** A data: URL, or undefined to go back to the initials. */
  setProjectLogo(id: string, logo: string | undefined): void {
    return this.projects.setProjectLogo(id, logo);
  }

  /** The project folder moved: "Найти заново". */
  moveProject(id: string, path: string): void {
    return this.projects.moveProject(id, path);
  }

  /** Forgets the project in Skaro; files on disk are untouched. */
  removeProject(id: string): void {
    return this.projects.removeProject(id);
  }

  getOpenTabs(): { projectId: string; active: boolean }[] {
    return this.projects.getOpenTabs();
  }

  setOpenTabs(projectIds: string[], activeId?: string): void {
    return this.projects.setOpenTabs(projectIds, activeId);
  }

  // ── settings ─────────────────────────────────────────────────────────────

  getSetting<T>(key: string, fallback: T): T {
    return this.settings.getSetting(key, fallback);
  }

  setSetting(key: string, value: unknown): void {
    return this.settings.setSetting(key, value);
  }

  // ── runtime task state ───────────────────────────────────────────────────

  setTaskRuntime(projectId: string, taskId: string, state: TaskRuntime, runId?: string): void {
    return this.runtime.setTaskRuntime(projectId, taskId, state, runId);
  }

  getTaskRuntime(projectId: string): Map<string, { state: TaskRuntime; runId?: string }> {
    return this.runtime.getTaskRuntime(projectId);
  }

  /**
   * After a restart no agent process is alive: running and queued tasks become idle.
   * Waiting tasks keep their state — their open interactions are shown again (agent-output.md, 6).
   */
  resetStaleRuntime(): { projectId: string; taskId: string; state: TaskRuntime }[] {
    return this.runtime.resetStaleRuntime();
  }

  // ── runs ─────────────────────────────────────────────────────────────────

  createRun(
    input: Omit<RunRecord, 'id' | 'startedAt' | 'endedAt' | 'outcome' | 'nativeSessionId'>,
  ): RunRecord {
    return this.runs.createRun(input);
  }

  getRun(id: string): RunRecord | undefined {
    return this.runs.getRun(id);
  }

  setRunSession(id: string, nativeSessionId: string): void {
    return this.runs.setRunSession(id, nativeSessionId);
  }

  finishRun(id: string, outcome: RunOutcome): void {
    return this.runs.finishRun(id, outcome);
  }

  /** Newest first. */
  listRuns(projectId: string, taskId?: string): RunRecord[] {
    return this.runs.listRuns(projectId, taskId);
  }

  // ── chats ────────────────────────────────────────────────────────────────

  createChat(input: {
    projectId: string;
    taskId?: string;
    agent: string;
    title: string;
    logPath: string;
  }): ChatRecord {
    return this.chats.createChat(input);
  }

  getChat(id: string): ChatRecord | undefined {
    return this.chats.getChat(id);
  }

  /** Chats of a project (or of one task), most recently active first. */
  listChats(
    projectId: string,
    options: { taskId?: string; archived?: boolean } = {},
  ): ChatRecord[] {
    return this.chats.listChats(projectId, options);
  }

  /** The agent of a chat never changes (D-24): only title, archive flag and session. */
  updateChat(
    id: string,
    patch: { title?: string; archived?: boolean; nativeSessionId?: string },
  ): void {
    return this.chats.updateChat(id, patch);
  }

  // ── merges ───────────────────────────────────────────────────────────────

  recordMerge(input: Omit<MergeRecord, 'id' | 'mergedAt' | 'revertCommit'>): MergeRecord {
    return this.merges.recordMerge(input);
  }

  markMergeReverted(id: string, revertCommit: string): void {
    return this.merges.markMergeReverted(id, revertCommit);
  }

  /** Newest first. */
  listMerges(projectId: string, taskId?: string): MergeRecord[] {
    return this.merges.listMerges(projectId, taskId);
  }

  // ── events ───────────────────────────────────────────────────────────────

  addEvent(projectId: string, kind: string, data: Record<string, unknown> = {}): void {
    return this.events.addEvent(projectId, kind, data);
  }

  /** Latest events first. */
  listEvents(projectId: string, limit = 20): EventRecord[] {
    return this.events.listEvents(projectId, limit);
  }

  // ── interactions ─────────────────────────────────────────────────────────

  openInteraction(input: Omit<InteractionRecord, 'openedAt' | 'closedAt' | 'resolution'>): void {
    return this.interactions.openInteraction(input);
  }

  closeInteraction(id: string, resolution: string): void {
    return this.interactions.closeInteraction(id, resolution);
  }

  listOpenInteractions(projectId?: string): InteractionRecord[] {
    return this.interactions.listOpenInteractions(projectId);
  }
}
