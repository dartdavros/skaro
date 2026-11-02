import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { Services, createServices } from '../app-services';
import { readTaskStopPacket, requireTaskStopCurrent } from './task-stop-packet';
import { prepareTaskStopReview } from './task-stop-review';
import { taskStopModels } from './task-stop-models';
import { verifyTaskStopLive } from './task-stop-live';
import { verifyTaskStopReplay } from './task-stop-replay';
import { verifyTaskStopMainRestart } from './task-stop-main-restart';
import { verifyTaskHandoffLocal } from './task-handoff-local';
import { verifyTaskCompletionPreflight } from './task-completion-preflight';
import { readTaskWorkflowPacket, verifyTaskWorkflowPacket } from './task-workflow-packet';

/** CLI-only composition. Read/replay modes cannot prepare a model host. */
export async function taskStopMode(args: string[], data: string, getServices: () => Services) {
  const name = args[2]!;
  if (name === '--task-workflow-check') {
    const packet = await readTaskWorkflowPacket(data, args[3]!, args[4]!);
    return {
      stage: 'task-workflow-check',
      options: {
        async builtinTasks() {
          throw new Error('Workflow inspection cannot prepare a model host');
        },
      },
      run: (services: Services) => verifyTaskWorkflowPacket(services, data, packet),
    };
  }
  if (
    ![
      '--task-stop-review',
      '--task-stop-check',
      '--task-stop-live',
      '--task-stop-replay',
      '--task-stop-main-restart',
      '--task-handoff-local',
      '--task-completion-preflight',
    ].includes(name)
  )
    return undefined;
  const packet =
    name === '--task-stop-review' ? undefined : await readTaskStopPacket(data, args[3]!, args[4]!);
  const models =
    ['--task-stop-live', '--task-stop-main-restart'].includes(name) && packet
      ? taskStopModels(getServices, data, packet)
      : undefined;
  let forbiddenPreparations = 0;
  const options: NonNullable<Parameters<typeof createServices>[3]> = models
    ? {
        builtinTasks: models.authorize,
        builtinEntries: resolve('apps/desktop/out/main'),
      }
    : {
        async builtinTasks() {
          forbiddenPreparations++;
          throw new Error('Task Stop review/replay does not authorize a model host');
        },
      };
  return {
    stage: name.slice(2),
    options,
    async run(services: Services, directory: string) {
      let proof: unknown;
      if (name === '--task-stop-review')
        proof = await prepareTaskStopReview(services, directory, data);
      else {
        assert(packet);
        if (name === '--task-stop-live') {
          assert(models);
          proof = await verifyTaskStopLive(services, data, directory, packet, args[4]!, models);
        } else if (name === '--task-stop-main-restart') {
          assert(models);
          proof = await verifyTaskStopMainRestart(
            services,
            data,
            directory,
            packet,
            args[4]!,
            args[5]!,
            models,
          );
        } else if (name === '--task-stop-replay') {
          proof = await verifyTaskStopReplay(services, data, packet, args[4]!, args[5]!);
        } else if (name === '--task-handoff-local') {
          proof = await verifyTaskHandoffLocal(
            services,
            data,
            directory,
            packet,
            args[4]!,
            args[5]!,
          );
        } else if (name === '--task-completion-preflight') {
          proof = await verifyTaskCompletionPreflight(services, data, packet, args[5]!, directory);
        } else
          proof = {
            budget: await requireTaskStopCurrent(services, data, packet),
            payloadHash: args[4],
            currentTaskRouteScopeAndHistory: true,
            modelRequests: 0,
            taskRunCreated: false,
            executionAuthorized: false,
          };
      }
      assert.equal(forbiddenPreparations, 0, 'Read/replay unexpectedly prepared a model host');
      return proof;
    },
  };
}
