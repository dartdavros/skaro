import { app } from 'electron';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AppDb, ownsResourceCapacity } from '@skaro/core';
import { ResourceManager } from '../resource-manager';
import { applicationResourceMeasurements } from '../resource-measurements';
import { RESOURCE_POLICY_KEY, resourceWorkCost } from '../resource-policy';
import { resourceVolume } from '../resource-budget';
import { startArchiagentReader } from './archiagent-host-reader';

app.setName('Skaro');
if (!app.requestSingleInstanceLock()) app.exit(1);
app.on('window-all-closed', () => undefined);
void app.whenReady().then(async () => {
  const data = app.getPath('userData'),
    directory = resolve(process.env.SKARO_AG1_CASE ?? '');
  assert(directory.startsWith(resolve(data, 'verification') + '\\'));
  await copyFile(
    join(directory, 'budget-two-projects-proof.json'),
    join(directory, `budget-two-projects-previous-${randomUUID()}.json`),
  ).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  // Deliberate owner-approved host-only exception. No AppState/createServices/recovery for either project.
  const db = AppDb.open(join(data, 'skaro.db'));
  const projects = ['78bc2cd3-981b-40ed-a395-c6c6bc7da51b', '089c1609-e2c3-4135-9f06-66a9c01e9906'];
  const roots = projects.map((id) => db.getProject(id)!.path);
  assert.equal(db.getProject(projects[0]!)?.name, 'Cat-pilot');
  assert.equal(db.getProject(projects[1]!)?.name, 'ChatRouter');
  const files = [join(roots[0]!, 'index.html'), join(roots[1]!, '.skaro/brief.md')];
  const hash = async (file: string) =>
    createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
  const before = await Promise.all(files.map(hash));
  const oldPolicy = db.getSetting<Record<string, unknown>>(RESOURCE_POLICY_KEY, {});
  const bounded = { ...oldPolicy, review: 1 };
  const initial = db.admission.all();
  const proof: Record<string, unknown> = {
    projects,
    files,
    startedAt: new Date().toISOString(),
    hostOnly: true,
    modelCalls: 0,
    sourceBefore: before,
  };
  const controller = new AbortController();
  const observations: unknown[] = [];
  const manager = new ResourceManager(
    db,
    () => applicationResourceMeasurements(db, new Set(), new Set([data, ...roots]), false),
    (lease) => observations.push(lease),
  );
  const ids: string[] = [],
    readers: Awaited<ReturnType<typeof startArchiagentReader>>[] = [];
  let code = 1,
    policyChanged = false;
  try {
    assert(
      initial.filter(ownsResourceCapacity).every((r) => r.cost.review === 0),
      'Never reduce capacity below existing real holdings',
    );
    db.settings.atomic(() => {
      assert.deepEqual(db.getSetting(RESOURCE_POLICY_KEY, {}), oldPolicy);
      db.setSetting(RESOURCE_POLICY_KEY, bounded);
    });
    policyChanged = true;
    const volume = await resourceVolume(data);
    const request = (index: number) => {
      const id = randomUUID();
      ids.push(id);
      return manager.acquire(
        {
          id,
          projectId: projects[index === 1 ? 1 : 0]!,
          ownerId: `ag1-host-reader:${id}`,
          intentId: id,
          checkpoint: 'real-read',
          cost: { ...resourceWorkCost(db, 'process', volume), review: 1 },
          locks: [],
        },
        {
          signal: controller.signal,
          requireCurrent: () => {
            assert.equal(
              db.getProject(projects[index === 1 ? 1 : 0]!)?.path,
              roots[index === 1 ? 1 : 0],
            );
          },
        },
      );
    };
    const first = await request(0);
    readers.push(await startArchiagentReader(files[0]!));
    const second = request(1),
      third = request(2);
    void second.catch(() => undefined);
    void third.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const queued = ids.slice(1).map((id) => db.admission.all().find((r) => r.id === id)!);
    assert(queued.every((r) => r.state === 'waiting_resource' && !ownsResourceCapacity(r)));
    assert.equal(
      db.admission
        .all()
        .filter(ownsResourceCapacity)
        .reduce((sum, r) => sum + r.cost.review, 0),
      1,
    );
    proof.waiting = queued;
    await readers[0]!.finish();
    manager.release(first, 'verified_reader_exit');
    const grantedSecond = await second;
    assert.equal(db.admission.all().find((r) => r.id === ids[2])!.state, 'waiting_resource');
    readers.push(await startArchiagentReader(files[1]!));
    assert.equal(readers[1]!.result.sha256, before[1]);
    await readers[1]!.finish();
    manager.release(grantedSecond, 'verified_reader_exit');
    const grantedThird = await third;
    readers.push(await startArchiagentReader(files[0]!));
    await readers[2]!.finish();
    manager.release(grantedThird, 'verified_reader_exit');
    assert.equal(readers[0]!.result.sha256, before[0]);
    assert.equal(readers[2]!.result.sha256, before[0]);
    assert.deepEqual(await Promise.all(files.map(hash)), before);
    for (const lease of initial)
      assert.deepEqual(db.admission.get(lease.projectId, lease.id), lease);
    proof.readers = readers.map(({ pid, birth, result }) => ({ pid, birth, result }));
    proof.admittedOrder = [first, grantedSecond, grantedThird].map((r) => ({
      project: r.projectId,
      sequence: r.sequence,
      id: r.id,
    }));
    proof.observations = observations;
    proof.noHeavyCopies = true;
    proof.noStarvation = true;
    proof.priorHoldingsPreserved = true;
    proof.measuredBudget = await applicationResourceMeasurements(
      db,
      new Set(),
      new Set([data, ...roots]),
      false,
    );
    code = 0;
  } catch (error) {
    proof.error = error instanceof Error ? error.stack : String(error);
  } finally {
    let allReadersExited = true;
    for (const reader of readers)
      await reader.finish().catch((error) => {
        proof.cleanupError = String(error);
        code = 1;
        allReadersExited = false;
      });
    controller.abort();
    await manager.close();
    for (const id of ids) {
      const lease = db.admission.all().find((r) => r.id === id);
      if (allReadersExited && lease && ownsResourceCapacity(lease)) {
        manager.release(lease, 'all_owned_readers_verified_exited');
      }
    }
    if (policyChanged)
      db.settings.atomic(() => {
        assert.deepEqual(
          db.getSetting(RESOURCE_POLICY_KEY, {}),
          bounded,
          'Never overwrite concurrent owner policy',
        );
        db.setSetting(RESOURCE_POLICY_KEY, oldPolicy);
      });
    proof.policyRestored = true;
    proof.passed = code === 0;
    await writeFile(
      join(directory, 'budget-two-projects-proof.json'),
      JSON.stringify(proof, null, 2),
    );
    db.close();
    process.send?.({ phase: 'budget-two-projects', passed: proof.passed, error: proof.error });
    app.exit(code);
  }
});
