import { environmentName, type AppDb, type EnvironmentConfig, type TaskKey } from '@skaro/core';
import type { EnvironmentStartTiming } from './task-environment-start';
import {
  activeEnvironment,
  retiredEnvironment,
  EnvironmentRegistryUnavailable,
} from './environment-registry-validation';

/** What Skaro promised a task: the name of its environment and its host ports. */
export interface EnvironmentRecord extends TaskKey {
  name: string;
  /** Written only when Skaro allocates a new task identity; absent on legacy records. */
  allocatedAt?: number;
  ports: Record<string, number>;
  /** Old links in the task feed keep addressing this task after a port is replaced. */
  previousPorts?: Record<string, number[]>;
  /** Measured cost of the last actual launch, including time waiting for Docker. */
  lastStart?: EnvironmentStartTiming;
  /** Task-specific launch command, retained while this environment exists. */
  start?: string;
  /** Existing main-copy services required for the first data copy. */
  source?: EnvironmentConfig['source'];
  /** Additional host access requested through the tool; Skaro assigns the numbers. */
  extraPorts?: string[];
  /** Service-owned candidate checkout; task checkouts use their normal path. */
  worktree?: string;
  /** The copy of the data was created (the project's `create` command succeeded). */
  created: boolean;
  /** Last time the task's agent worked or asked for the environment. */
  usedAt: number;
}

const KEY = 'environments';
const RETIRED = 'environments.retired';
export type RetiredEnvironment = TaskKey &
  Pick<EnvironmentRecord, 'name' | 'allocatedAt' | 'worktree' | 'source'>;

/** Environment records in the app database; they outlive restarts and stopped containers. */
export class EnvironmentRegistry {
  private readonly db: Pick<AppDb, 'getSetting' | 'setSetting'>;
  private readonly invalid?: () => void;
  constructor(db: Pick<AppDb, 'getSetting' | 'setSetting'>, invalid?: () => void) {
    this.db = db;
    this.invalid = invalid;
  }

  all(): EnvironmentRecord[] {
    return this.read(KEY, activeEnvironment);
  }

  private read<T>(key: string, valid: (value: unknown) => value is T): T[] {
    try {
      const value = this.db.getSetting<unknown>(key, [], { strict: true });
      if (Array.isArray(value) && value.every(valid)) return value;
    } catch {
      /* Do not overwrite unreadable metadata with an empty registry. */
    }
    this.invalid?.();
    throw new EnvironmentRegistryUnavailable();
  }

  find(key: TaskKey): EnvironmentRecord | undefined {
    return this.all().find((r) => r.projectId === key.projectId && r.taskId === key.taskId);
  }

  /** The record of the task, created with a name no other task holds. */
  ensure(key: TaskKey, project: string): EnvironmentRecord {
    const existing = this.find(key);
    if (existing) return existing;
    const taken = new Set([...this.all(), ...this.retired()].map((r) => r.name));
    const base = environmentName(project, key.taskId);
    // Two projects may share a folder name: the project id tells them apart.
    const previous = this.retired().find(
      (r) => r.projectId === key.projectId && r.taskId === key.taskId,
    );
    let name = previous?.name ?? base;
    if (!previous) {
      let suffix = 0;
      while (taken.has(name))
        name = `${base}-${key.projectId.slice(0, 6).toLowerCase()}-${++suffix}`;
    }
    const record = {
      ...key,
      name,
      ports: {},
      created: false,
      usedAt: Date.now(),
      ...(!previous
        ? { allocatedAt: Date.now() }
        : previous.allocatedAt && { allocatedAt: previous.allocatedAt }),
    };
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
    const record = this.find(key);
    if (record) {
      const retired = this.retired().filter((item) => item.name !== record.name);
      const { name, allocatedAt, worktree, source } = record;
      this.db.setSetting(RETIRED, [...retired, { ...key, name, allocatedAt, worktree, source }]);
    }
    this.db.setSetting(
      KEY,
      this.all().filter((r) => r.projectId !== key.projectId || r.taskId !== key.taskId),
    );
  }

  /** Durable ownership survives container removal, including later orphan sweeps. */
  retired(): RetiredEnvironment[] {
    return this.read(RETIRED, retiredEnvironment);
  }

  /** Ports promised to any environment: its services may be stopped, the ports stay theirs. */
  takenPorts(): Set<number> {
    return new Set(this.all().flatMap((r) => Object.values(r.ports)));
  }
}
