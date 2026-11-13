import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Services } from '../app-services';
import { eventually } from './resource-workflow-observation';
import { taskInputSnapshot, type TaskInputSnapshot } from '../task-preflight-inputs';
import { taskC4Protocol } from '../c4-protocol';

/** A fresh bounded owner instruction after the real stale-input guard; never resends the unknown command. */
export async function recheckArchiagentInputs(s: Services, project: string) {
  const context = s.projects.get(project);
  const task = (await context.load()).tasks.find(
    (t) => t.title === 'Приёмка AG-1: актуальные входы и новый протокол Cat-pilot',
  );
  assert(task);
  const marker = task.body.match(
    /Контрольная версия требований: (AG1_INPUT_[a-f\d]+_CURRENT)/,
  )?.[1];
  assert(marker, 'Use the existing genuine requirement revision, not a replacement');
  const before = await s.runs.open(project, task.id),
    commandId = randomUUID();
  const previousTurns = before.timeline!.turns.length;
  const run = s.db.latestRun(project, task.id)!;
  assert.equal(taskC4Protocol(s.db, project, run.id), 'impact-v1');
  const stale = s.db.commands
    .forOwner(`${project}:${task.id}`)
    .filter((c) => c.owner === `${project}:${task.id}` && c.state === 'uncertain')
    .map((c) => c.id);
  // A real explicit Stop must first retire the unknown writer; a fresh request cannot bypass it.
  await s.runs.interrupt(project, task.id);
  for (const id of stale) {
    assert.equal(s.db.commands.get(id)?.state, 'cancelled');
    assert.equal(s.db.coordination.getOperation(project, `owner-command:${id}`)?.state, 'failed');
  }
  s.commands.accept('task.send', project, task.id, {
    commandId,
    text: `Новое явное read-only поручение для AG-1 после изменения входов. Не повторяй прежнюю неопределённую команду. Только через read_project_memory с source="${task.path}" прочитай текущую строку «Контрольная версия требований», процитируй её точно и закончи. Не меняй файлы, критерии или политики, не запускай команды и не сдавай результат.`,
  });
  try {
    const result = await eventually(
      () => s.runs.open(project, task.id),
      (v) =>
        v.timeline!.turns.length > previousTurns &&
        !!v.timeline!.turns.at(-1)?.outcome &&
        v.timeline!.status === 'idle',
      'fresh read-only intent validates current actual requirements',
      240000,
    );
    assert.equal(result.timeline!.turns.at(-1)?.outcome, 'done');
    assert(
      result.timeline!.items.some(
        (i) =>
          i.kind === 'message' &&
          i.role === 'agent' &&
          i.turnId === result.timeline!.turns.at(-1)?.id &&
          i.text?.includes(marker),
      ),
    );
    const current = await taskInputSnapshot(s.db, context, await context.load(), task.id);
    const saved = s.db.getSetting<TaskInputSnapshot | undefined>(
      `coordination.inputs.${run.id}`,
      undefined,
    );
    assert.equal(saved?.version, current.version);
    for (const id of stale) assert.equal(s.db.commands.get(id)?.state, 'cancelled');
    return {
      task: task.id,
      run: run.id,
      protocol: 'impact-v1',
      actualValidatedInputs: current.version,
      marker,
      freshOwnerCommand: commandId,
      oldUnknownCommandsRetiredOnlyAfterVerifiedStop: stale,
      automaticResends: 0,
      dirtyUserWorkTested: false,
    };
  } finally {
    await s.runs.interrupt(project, task.id);
  }
}
