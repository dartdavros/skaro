import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { AppDb, type ResourceLeaseRequest } from '@skaro/core';
import { ResourceManager } from './resource-manager';
import { measureResourceBudget, resourceVolume } from './resource-budget';

const data = process.env.SKARO_ADMISSION_VERIFY_DATA;
const execute = promisify(execFile);

/** Explicit live acceptance: real registry, real SQLite, real permanent Cat-pilot service. */
it.skipIf(!data)(
  'gates a real Cat-pilot observation and fences owner cancellation',
  async () => {
    const file = join(data!, 'skaro.db');
    const registry = new DatabaseSync(file, { readOnly: true });
    let project: { id: string; path: string };
    try {
      const rows = registry
        .prepare('SELECT id,path FROM projects WHERE name=? COLLATE NOCASE')
        .all('Cat-pilot') as { id: string; path: string }[];
      expect(rows).toHaveLength(1);
      project = rows[0]!;
    } finally {
      registry.close();
    }
    const inspect = async () => {
      const { stdout } = await execute(
        'docker',
        ['compose', '--project-directory', project.path, 'ps', '--format', 'json'],
        { windowsHide: true, timeout: 30000 },
      );
      const records = stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      expect(records).toHaveLength(1);
      const value = records[0] as { ID: string; Project: string; State: string; Health: string };
      expect(value.Project).toBe('cat-pilot-dev');
      expect(value.State).toBe('running');
      expect(value.Health).toBe('healthy');
      const inspected = await execute('docker', ['inspect', '--format', '{{.Id}}', value.ID], {
        windowsHide: true,
        timeout: 30000,
      });
      const fullId = inspected.stdout.trim();
      expect(fullId).toMatch(/^[a-f0-9]{64}$/);
      expect(fullId.startsWith(value.ID)).toBe(true);
      return { ...value, ID: fullId };
    };
    const before = await inspect();
    const volume = await resourceVolume(project.path);
    expect(volume).toBe(await resourceVolume(join(project.path, 'css')));
    const bytes = (await stat(join(project.path, 'index.html'))).size;
    const db = AppDb.open(file);
    db.shell.scopeTo(project.id);
    const observed = db.resources
      .list(project.id)
      .find((resource) => resource.identity.composeProject === before.Project);
    const resource =
      observed ??
      db.resources.register({
        projectId: project.id,
        kind: 'environment',
        identity: { composeProject: before.Project },
        owner: { kind: 'project', id: project.id },
        purpose: 'project-dev',
        ownership: 'registered',
        preservation: 'persistent',
        generation: 1,
        consumers: [],
        state: 'available',
        objectIds: [before.ID],
      });
    expect(resource.objectIds).toEqual([before.ID]);
    expect(resource.purpose).toBe('project-dev');
    expect(resource.owner).toEqual({ kind: 'project', id: project.id });
    expect(resource.preservation).toBe('persistent');
    const policy = {
      reserveRamBytes: 1024 ** 3,
      reserveDiskBytes: 1024 ** 3,
      reserveCpuMillis: 1000,
      model: 0,
      environment: 0,
      build: 0,
      review: 0,
      accounts: {},
    };
    let notifyWaiting: (() => void) | undefined;
    const manager = new ResourceManager(
      db,
      () => measureResourceBudget(policy, [project.path]),
      (lease) => {
        if (lease.reason === 'budget_review') notifyWaiting?.();
      },
    );
    const input = (): ResourceLeaseRequest => ({
      id: randomUUID(),
      projectId: project.id,
      ownerId: 'rc2-live-http-observation',
      intentId: randomUUID(),
      checkpoint: 'read_real_catpilot_html',
      cost: {
        ramBytes: bytes,
        cpuMillis: 0,
        model: 0,
        environment: 0,
        build: 0,
        review: 1,
        diskBytes: { [volume]: 0 },
      },
      locks: [{ resourceId: resource.id, generation: resource.generation, mode: 'shared' }],
    });
    const requests: ResourceLeaseRequest[] = [];
    try {
      const first = input();
      requests.push(first);
      const stopped = new AbortController();
      const waiting = new Promise<void>((resolve) => {
        notifyWaiting = resolve;
      });
      const pending = manager.acquire(first, {
        signal: stopped.signal,
        requireCurrent: () => {
          stopped.signal.throwIfAborted();
        },
      });
      const rejected = expect(pending).rejects.toThrow('Owner stopped observation');
      await waiting;
      expect(db.admission.get(project.id, first.id)?.state).toBe('waiting_resource');
      expect((await inspect()).ID).toBe(before.ID);
      stopped.abort(new Error('Owner stopped observation'));
      await rejected;
      policy.review = 1;
      const next = input();
      requests.push(next);
      const lease = await manager.acquire(next, {
        signal: new AbortController().signal,
        requireCurrent: async () => {
          await inspect();
        },
      });
      expect(db.admission.get(project.id, first.id)?.state).toBe('stopped_by_owner');
      expect(
        db.resources.get(resource.id)?.consumers.some((c) => c.id === `lease:${lease.id}`),
      ).toBe(true);
      const response = await fetch('http://127.0.0.1:18941');
      expect(response.status).toBe(200);
      expect(Buffer.byteLength(await response.text())).toBe(bytes);
      manager.release(lease, 'real_http_observation_completed');
      expect((await inspect()).ID).toBe(before.ID);
      expect(
        db.resources.get(resource.id)?.consumers.some((c) => c.id === `lease:${lease.id}`),
      ).toBe(false);
      console.info(
        'RC-2 live: actual Cat-pilot HTTP, policy wait, owner stop, new admission, same container',
      );
    } finally {
      await manager.close();
      // This test owns only observation leases. It never stops/removes the dev service.
      for (const request of requests) {
        const lease = db.admission.get(project.id, request.id);
        if (lease && ['waiting_resource', 'waiting_quota'].includes(lease.state))
          db.admission.stop(project.id, lease.id, lease.revision);
        else if (lease && ['granted', 'retained'].includes(lease.state))
          db.admission.release(
            project.id,
            lease.id,
            lease.revision,
            { [resource.id]: resource.generation },
            'http_observation_scope_closed',
          );
      }
      db.close();
    }
  },
  45000,
);
