import { resolve } from 'node:path';
import type { Services } from '../app-services';
import { readTaskWorkflowPacket, verifyTaskWorkflowPacket } from './task-workflow-packet';
import { workflowModels } from './task-workflow-models';
import { verifyTaskWorkflowLive } from './task-workflow-live';
import { auditTaskWorkflow } from './task-workflow-audit';
import { prepareTaskWorkflowContinuation } from './task-workflow-continuation';
import { taskContinuationMode } from './task-continuation-mode';

export async function taskWorkflowMode(args: string[], data: string, getServices: () => Services) {
  const continuation = await taskContinuationMode(args, data, getServices);
  if (continuation) return continuation;
  const rebind = args[2] === '--task-workflow-rebind-live';
  const strict = rebind || args[2] === '--task-workflow-retry-strict';
  const live =
    strict ||
    [
      '--task-workflow-live',
      '--task-workflow-retry-unspawned',
      '--task-workflow-review-live',
    ].includes(args[2]!);
  const audit = args[2] === '--task-workflow-audit';
  const prepare = args[2] === '--task-workflow-prepare-continuation';
  if (!live && !audit && !prepare && args[2] !== '--task-workflow-check') return undefined;
  const packet = await readTaskWorkflowPacket(data, args[3]!, args[4]!);
  const models = live ? workflowModels(getServices, data, packet, strict) : undefined;
  return {
    stage: live
      ? 'task-workflow-live'
      : prepare
        ? 'task-workflow-prepare-continuation'
        : audit
          ? 'task-workflow-audit'
          : 'task-workflow-check',
    options: {
      builtinEntries: resolve('apps/desktop/out/main'),
      builtinTasks:
        models?.authorize ??
        (async () => {
          throw new Error('Workflow inspection cannot prepare a model host');
        }),
    },
    run: (services: Services, directory: string) =>
      models
        ? verifyTaskWorkflowLive(services, data, directory, packet, models, {
            proofPath: args[5],
            review: args[2] === '--task-workflow-review-live',
            rebind,
            strict,
          })
        : prepare
          ? prepareTaskWorkflowContinuation(services, data, directory, packet, args[5]!)
          : audit
            ? auditTaskWorkflow(services, data, packet, args[5]!)
            : verifyTaskWorkflowPacket(services, data, packet),
  };
}
