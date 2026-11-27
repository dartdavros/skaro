import type { TaskDetail } from '../../../shared/ipc';
import { taskCanStop } from './task-lifecycle-actions';

export function createTaskStopControl(options: {
  task: () => TaskDetail | undefined;
  stage: () => boolean;
  running: () => boolean;
  stop: () => Promise<void>;
}) {
  let stopping = $state(false);
  const canStop = $derived.by(() => {
    const task = options.task();
    return stopping || (options.stage() ? options.running() : !!task && taskCanStop(task));
  });

  return {
    get canStop() {
      return canStop;
    },
    get stopping() {
      return stopping;
    },
    async stop() {
      if (stopping || !canStop) return;
      stopping = true;
      try {
        await options.stop();
      } finally {
        stopping = false;
      }
    },
  };
}
