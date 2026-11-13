import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { assertWorkflowGraph, parseProjectWorkflow, indexTasks, isBlocked } from '@skaro/core';
import type { Services } from '../app-services';
import { finishedTask } from './resource-workflow-observation';
import { requireTaskInputsCurrent } from '../task-preflight';
import { taskInputSnapshot, verifyPrerequisites } from '../task-preflight-inputs';

export async function verifyCoordinatorInputs(
  s: Services,
  projectId: string,
  taskId: string,
  proof: Record<string, unknown>,
) {
  const context = s.projects.get(projectId);
  const task = (await context.store.load()).tasks.find((t) => t.id === taskId)!;
  const path = join(context.root, task.path);
  const original = await readFile(path, 'utf8');
  const revised =
    original +
    '\n\nПроверка AC-2: при продолжении повторно сверить актуальную версию требований и сохранить исходники.\n';
  const prompt =
    'Проверка AC-2: только выполни node --check js/controls.js, кратко сообщи результат и закончи ход. Не меняй файлы, не делай коммиты, не запускай сервисы и не вызывай submit_result.';
  let edited = false;
  try {
    const count = (await s.runs.open(projectId, taskId)).timeline?.turns.length ?? 0;
    await s.runs.send(projectId, taskId, { text: prompt, commandId: randomUUID() });
    await finishedTask(s, projectId, taskId, count);
    const active = s.runs['engine'].active.get(`${projectId}\n${taskId}`)!;
    assert(active.session, 'Must exercise an existing native session');
    const native = active.run.nativeSessionId;
    const old = (await s.memory.index(projectId)).sources.find((d) => d.id === task.path)!;
    await writeFile(path, revised);
    edited = true;
    await assert.rejects(requireTaskInputsCurrent(s.runs['engine'], active), /stale/);
    await assert.rejects(
      s.memory.read(projectId, { source: old.id, version: old.version }),
      /changed/,
    );
    const previous = active.timeline.state.turns.length;
    await s.runs.send(projectId, taskId, { text: prompt, commandId: randomUUID() });
    const resumed = await finishedTask(s, projectId, taskId, previous);
    assert.equal(resumed.timeline?.turns.at(-1)?.outcome, 'done');
    assert.equal(active.run.nativeSessionId, native);
    const refreshed = (await s.memory.index(projectId)).sources.find((d) => d.id === task.path)!;
    assert.notEqual(refreshed.version, old.version);
    proof.inputs = {
      taskId,
      native,
      previous: old.version,
      current: refreshed.version,
      resumedExistingSession: true,
    };
  } finally {
    if (edited) {
      assert.equal(
        await readFile(path, 'utf8'),
        revised,
        'Do not overwrite concurrent owner edits',
      );
      await writeFile(path, original);
      context.invalidate();
    }
    await s.runs.interrupt(projectId, taskId);
  }
  const artifacts = await context.store.load();
  const dependent = artifacts.tasks.find(
    (t) => t.status === 'todo' && t.dependsOn.length && !t.unblocked,
  );
  assert(dependent, 'Use a real not-started dependent task for D-45 policy evaluation');
  const reviewInputs = artifacts.tasks.map((t) =>
    dependent.dependsOn.includes(t.id) ? { ...t, status: 'review' as const } : t,
  );
  assert(isBlocked(dependent, indexTasks(reviewInputs)));
  assert(!isBlocked({ ...dependent, unblocked: true }, indexTasks(reviewInputs)));
  const self = artifacts.tasks.map((t) => (t.id === taskId ? { ...t, dependsOn: [taskId] } : t));
  assert.throws(() => assertWorkflowGraph(self, {}, taskId), /Dependency cycle/);
  const file = await readFile(join(context.root, 'index.html'));
  const input = {
    kind: 'artifact',
    id: 'page',
    phase: 'prerequisite',
    producedBy: taskId,
    path: 'index.html',
    sha256: createHash('sha256').update(file).digest('hex'),
  };
  const workflow = parseProjectWorkflow({ [taskId]: [input] })!;
  assert.throws(() => assertWorkflowGraph(artifacts.tasks, workflow, taskId), /future result/);
  const verifiedInput = { ...input, producedBy: undefined };
  await verifyPrerequisites(
    {
      ...artifacts,
      config: {
        ...artifacts.config,
        workflow: parseProjectWorkflow({ [taskId]: [verifiedInput] }),
      },
    },
    taskId,
    context.root,
  );
  await assert.rejects(
    verifyPrerequisites(
      {
        ...artifacts,
        config: {
          ...artifacts.config,
          workflow: parseProjectWorkflow({
            [taskId]: [{ ...verifiedInput, sha256: '0'.repeat(64) }],
          }),
        },
      },
      taskId,
      context.root,
    ),
    /different SHA256/,
  );
  await verifyPrerequisites(
    {
      ...artifacts,
      config: {
        ...artifacts.config,
        workflow: parseProjectWorkflow({ [taskId]: [{ ...input, phase: 'result' }] }),
      },
    },
    taskId,
    context.root,
  );
  const snapshot = await taskInputSnapshot(s.db, context, artifacts, taskId);
  proof.preflightPolicy = {
    version: snapshot.version,
    cycleRejected: true,
    futurePrerequisiteRejected: true,
    ordinaryReviewBlocked: true,
    exactArtifactHashChecked: true,
  };
  return snapshot;
}
