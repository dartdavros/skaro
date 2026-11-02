import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import { BUILTIN_CONTRACT_VERSIONS } from '@skaro/timeline';
import type { Services } from '../app-services';
import type { BuiltinTaskAuthorization } from '../builtin-task-models';
import { TaskExecution } from '../task-execution';
import { registerTaskBudgetJournal } from '../credentials/task-budget-journals';
import { taskBudgetSourceId } from '../credentials/task-budget-source';
import { quoteLiveRequest } from '../credentials/live-budget';
import { requireTaskStopCurrent } from './task-stop-packet';
import { requireTaskStopEnvelope, taskStopPins } from './task-stop-envelope';
import type { TaskStopReview } from './task-stop-review';

/** Only genuine TaskRunSessions call this; no alternate runtime, task or admission is created. */
export function taskStopModels(
  getServices: () => Services,
  data: string,
  reviewed: TaskStopReview,
) {
  const ledger = join(data, 'verification/openrouter-ba4');
  const generations: Parameters<BuiltinTaskAuthorization>[0][] = [];
  let quotes = 0,
    dispatchPermits = 0;
  const authorize: BuiltinTaskAuthorization = async (input) => {
    const services = getServices();
    const { scope } = input;
    assert(scope.runId);
    assert.deepEqual(scope, {
      kind: 'task',
      projectId: reviewed.project.id,
      taskId: 'T-006',
      runId: scope.runId,
    });
    assert(generations.length < 2, 'Only two native generations were reviewed');
    if (generations[0]) {
      assert.equal(scope.runId, generations[0].scope.runId);
      assert.equal(input.sessionId, generations[0].sessionId);
      assert.equal(input.journalPath, generations[0].journalPath);
      assert.notEqual(input.admissions.admission.id, generations[0].admissions.admission.id);
      assert(
        input.admissions.admission.generation > generations[0].admissions.admission.generation,
      );
    }
    const sourceId = taskBudgetSourceId(scope.runId, input.sessionId);
    const current = { runId: scope.runId, sourceId };
    await requireTaskStopCurrent(services, data, reviewed, current);
    assert.equal(input.options.cwd, reviewed.project.root);
    assert.equal(input.options.instructions, reviewed.wireComposition.instructions);
    assert.equal(input.options.permissionMode, 'ask');
    assert.equal(input.options.planFirst, true);
    // Lifecycle-only owner scenario: do not schedule implementation/automatic continuation.
    new TaskExecution(services.db, scope.runId).stop();
    generations.push(input);
    const checkpoint = async (signal: AbortSignal) =>
      registerTaskBudgetJournal({
        db: services.db,
        ledger,
        scope,
        journal: input.journalPath,
        admission: input.admissions.admission,
        admissions: input.admissions,
        signal,
      });
    const requireRequest = async (
      request: Parameters<typeof requireTaskStopEnvelope>[1],
      signal: AbortSignal,
    ) => {
      signal.throwIfAborted();
      assert.equal(await checkpoint(signal), sourceId);
      const journal = await readRuntimeJournal(input.journalPath, input.sessionId);
      requireTaskStopEnvelope(journal, request, reviewed);
      await requireTaskStopCurrent(services, data, reviewed, current);
      await input.admissions.requireActive(input.admissions.admission, signal);
    };
    return {
      config: {
        sessionId: input.sessionId,
        journalPath: input.journalPath,
        route: reviewed.wireComposition.route,
        permissionMode: 'ask',
        versions: BUILTIN_CONTRACT_VERSIONS,
        tools: {
          cwd: input.options.cwd,
          readDirs: [],
          readOnly: true,
          artifactDir: input.artifactDir,
        },
        context: { scopePath: '.', documents: [], pins: taskStopPins(reviewed) },
      },
      price: { prompt: 0.5, completion: 2, request: 0 },
      maxSteps: 1,
      modelTools: [],
      operations: [],
      tools: {
        revision: 'task-stop-no-tools-v1',
        chatToolsRequired: false,
        selectChatTools: () => [],
        requireAllowed() {
          throw new Error('No tool execution is authorized by task Stop acceptance');
        },
        projectResult() {
          throw new Error('No tool results are authorized by task Stop acceptance');
        },
      },
      requests: {
        async reserve(id, request, signal) {
          await requireRequest(request, signal);
          assert(request.kind === 'chat');
          quotes++;
          return { ...quoteLiveRequest(request.value, id) };
        },
        async requireDispatch(_id, request, signal) {
          await requireRequest(request, signal);
          dispatchPermits++;
        },
      },
    };
  };
  return { authorize, generations, counts: () => ({ quotes, dispatchPermits }) };
}
