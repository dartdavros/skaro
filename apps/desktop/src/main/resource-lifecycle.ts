import { randomUUID } from 'node:crypto';
import type { AppDb, ResourceRecord } from '@skaro/core';

export interface LifecycleStep {
  id: string;
  resourceId: string;
  generation: number;
  step: string;
  state: 'requested' | 'running' | 'verified' | 'failed';
  attempts: number;
  updatedAt: number;
}
type Store = Pick<AppDb, 'resources' | 'getSetting' | 'setSetting' | 'addEvent'>;
type Action = {
  guard: () => void | Promise<void>;
  verify: () => boolean | Promise<boolean>;
  execute: () => void | Promise<void>;
};
const pending = new WeakMap<Store, Map<string, Promise<void>>>();

/** Persist before effects, verify after effects, reobserve before retry. Never infer success from a timer. */
export class ResourceLifecycle {
  private readonly db: Store;
  constructor(db: Store) {
    this.db = db;
  }
  private key(resource: ResourceRecord, step: string) {
    return `resource.lifecycle.${resource.id}.${step}.generation.${resource.generation}`;
  }
  read(resource: ResourceRecord, step: string): LifecycleStep | undefined {
    const current = this.db.getSetting<LifecycleStep | undefined>(
      this.key(resource, step),
      undefined,
    );
    const legacy =
      current ??
      this.db.getSetting<LifecycleStep | undefined>(
        `resource.lifecycle.${resource.id}.${step}`,
        undefined,
      );
    // Legacy checkpoints are read-only and belong exclusively to their recorded generation.
    return legacy?.resourceId === resource.id &&
      legacy.generation === resource.generation &&
      legacy.step === step
      ? legacy
      : undefined;
  }
  run(resource: ResourceRecord, step: string, action: Action): Promise<void> {
    let operations = pending.get(this.db);
    if (!operations) pending.set(this.db, (operations = new Map()));
    // Generations have separate durable rows, but share one effect barrier for this resource/step.
    const key = `${resource.id}.${step}`;
    const work = (operations.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.execute(resource, step, action));
    operations.set(key, work);
    return work.finally(() => {
      if (operations.get(key) === work) operations.delete(key);
    });
  }
  private async execute(resource: ResourceRecord, step: string, action: Action): Promise<void> {
    const old = this.read(resource, step);
    let row: LifecycleStep =
      old?.generation === resource.generation
        ? old
        : {
            id: randomUUID(),
            resourceId: resource.id,
            generation: resource.generation,
            step,
            state: 'requested',
            attempts: 0,
            updatedAt: Date.now(),
          };
    const save = (state: LifecycleStep['state']) => {
      row = { ...row, state, updatedAt: Date.now() };
      this.db.setSetting(this.key(resource, step), row);
      this.db.addEvent(resource.projectId, 'resource_lifecycle', {
        resource: resource.id,
        generation: resource.generation,
        operation: row.id,
        step,
        state,
      });
    };
    const guard = async () => {
      const current = this.db.resources.get(resource.id);
      if (!current || current.generation !== resource.generation)
        throw new Error('Resource generation changed');
      await action.guard();
      if (this.db.resources.get(resource.id)?.generation !== resource.generation)
        throw new Error('Resource generation changed');
    };
    try {
      await guard();
      const verified = await action.verify();
      await guard();
      if (verified) {
        if (row.state !== 'verified') save('verified');
        return;
      }
      if (row.state === 'verified') row = { ...row, id: randomUUID(), attempts: 0 };
      save('requested');
      row = { ...row, attempts: row.attempts + 1 };
      save('running');
      await guard();
      await action.execute();
      if (!(await action.verify())) throw new Error('Resource cleanup step is not verified');
      await guard();
      save('verified');
    } catch (error) {
      save('failed');
      throw error;
    }
  }
}
