import assert from 'node:assert/strict';
import type { Services } from '../app-services';
import { hasOwnerCommand, isOwnerCommandMessage } from '../owner-command-history';
import { taskInputSnapshot, type TaskInputSnapshot } from '../task-preflight-inputs';
import { taskC4Protocol } from '../c4-protocol';
import { requireNativeTaskStopProof } from '../native-task-stop-proof';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Independently verify a real completed command; observation never sends a model request. */
export async function observeArchiagentInputs(
  s: Services,
  project: string,
  commandId: string,
  priorId: string,
  directory: string,
) {
  const command = s.db.commands.get(commandId),
    prior = s.db.commands.get(priorId);
  assert(
    command?.method === 'task.send' && command.args[0] === project && command.state === 'delivered',
  );
  const taskId = String(command.args[1]);
  assert.equal(prior?.owner, command.owner);
  assert.equal(prior?.state, 'cancelled');
  const stopped = s.db.coordination.getOperation(project, `owner-command:${priorId}`);
  assert.equal(stopped?.state, 'failed');
  assert.equal(stopped?.evidence?.code, 'owner_delivery_stopped');
  const context = s.projects.get(project),
    task = await context.store.readTask(taskId);
  assert.equal(task.title, 'Приёмка AG-1: актуальные входы и новый протокол Cat-pilot');
  const marker = task.body.match(
    /Контрольная версия требований: (AG1_INPUT_[a-f\d]+_CURRENT)/,
  )?.[1];
  assert(marker);
  const view = await s.runs.open(project, taskId),
    run = s.db.latestRun(project, taskId)!;
  await writeFile(
    join(directory, 'inputs-native-outcome.json'),
    JSON.stringify(
      {
        commandId,
        priorId,
        marker,
        turns: view.timeline!.turns,
        messages: view.timeline!.items.flatMap((i) =>
          i.kind === 'message' && i.role === 'agent'
            ? [{ turnId: i.turnId, text: i.text?.slice(0, 2000) }]
            : [],
        ),
      },
      null,
      2,
    ),
  );
  assert.equal(taskC4Protocol(s.db, project, run.id), 'impact-v1');
  assert(
    hasOwnerCommand(view.timeline, commandId),
    'Only an actual native echo establishes delivery',
  );
  const echoes = view.timeline!.items.filter((item) => isOwnerCommandMessage(item, commandId));
  assert.equal(echoes.length, 1, 'One native echo for the exact new command');
  assert.equal(
    hasOwnerCommand(view.timeline, priorId),
    false,
    'The stale command was never replayed',
  );
  const turnIndex = view.timeline!.turns.findIndex((turn) => turn.id === echoes[0]!.turnId);
  assert(turnIndex >= 0);
  const turn = view.timeline!.turns[turnIndex]!;
  assert.equal(turn.outcome, 'done');
  assert(
    view.timeline!.items.some(
      (i) =>
        i.kind === 'message' &&
        i.role === 'agent' &&
        i.turnId === turn.id &&
        i.text?.includes(marker),
    ),
    'The native turn owned by this exact command must quote the current requirement version',
  );
  const current = await taskInputSnapshot(s.db, context, await context.load(), taskId);
  const saved = s.db.getSetting<TaskInputSnapshot | undefined>(
    `coordination.inputs.${run.id}`,
    undefined,
  );
  assert.equal(saved?.version, current.version);
  const receipt = s.db.getSetting<{ epoch: number }>(`native.task-stop.${run.id}`, { epoch: -1 });
  requireNativeTaskStopProof(s.db, run, { kind: 'run', id: run.id, version: receipt.epoch });
  return {
    task: taskId,
    run: run.id,
    protocol: 'impact-v1',
    commandId,
    priorId,
    actualValidatedInputs: current.version,
    marker,
    nativeCurrentVersionVerified: true,
    verifiedStopRetiredPriorWriter: true,
    priorCommandReexecuted: false,
    observationModelCalls: 0,
    turnUsage: turn.usage,
    laterControllerTurns: view
      .timeline!.turns.slice(turnIndex + 1)
      .map((t) => ({ id: t.id, outcome: t.outcome, usage: t.usage })),
    driverBoundary:
      'Original polling kept a mutable turns reference and missed the completed owner turn; subsequent controller turns are recorded, not counted as an additional owner delivery.',
    dirtyUserWorkTested: false,
  };
}
