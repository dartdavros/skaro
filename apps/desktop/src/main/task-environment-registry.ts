import { environmentName, type AppDb, type TaskKey } from '@skaro/core';

/** What Skaro promised a task: the name of its environment and its host ports. */
export interface EnvironmentRecord extends TaskKey {
  name: string;
  ports: Record<string, number>;
  /** The copy of the data was created (the project's `create` command succeeded). */
  created: boolean;
  /** Last time the task's agent worked or asked for the environment. */
  usedAt: number;
}

const KEY = 'environments';

/** Environment records in the app database; they outlive restarts and stopped containers. */
export class EnvironmentRegistry {
  private readonly db: Pick<AppDb, 'getSetting' | 'setSetting'>;
  constructor(db: Pick<AppDb, 'getSetting' | 'setSetting'>) {
    this.db = db;
  }

  all(): EnvironmentRecord[] {
    return this.db.getSetting<EnvironmentRecord[]>(KEY, []);
  }

  find(key: TaskKey): EnvironmentRecord | undefined {
    return this.all().find((r) => r.projectId === key.projectId && r.taskId === key.taskId);
  }

  /** The record of the task, created with a name no other task holds. */
  ensure(key: TaskKey, project: string): EnvironmentRecord {
    const existing = this.find(key);
    if (existing) return existing;
    const taken = new Set(this.all().map((r) => r.name));
    const base = environmentName(project, key.taskId);
    // Two projects may share a folder name: the project id tells them apart.
    const name = taken.has(base) ? `${base}-${key.projectId.slice(0, 6).toLowerCase()}` : base;
    const record = { ...key, name, ports: {}, created: false, usedAt: Date.now() };
    this.db.setSetting(KEY, [...this.all(), record]);
    return record;
  }

  update(key: TaskKey, change: Partial<EnvironmentRecord>): EnvironmentRecord | undefined {
    let updated: EnvironmentRecord | undefined;
    const next = this.all().map((r) => {
      if (r.projectId !== key.projectId || r.taskId !== key.taskId) return r;
      updated = { ...r, ...change };
      return updated;
    });
    if (updated) this.db.setSetting(KEY, next);
    return updated;
  }

  remove(key: TaskKey): void {
    this.db.setSetting(
      KEY,
      this.all().filter((r) => r.projectId !== key.projectId || r.taskId !== key.taskId),
    );
  }

  /** Ports promised to any environment: its services may be stopped, the ports stay theirs. */
  takenPorts(): Set<number> {
    return new Set(this.all().flatMap((r) => Object.values(r.ports)));
  }
}
