import type { ShutdownStage } from '../shared/shutdown';
import type { ShutdownProgress } from './shutdown-progress';
import { trace } from './trace';

type ShutdownStep = readonly [name: string, actions: (() => void | Promise<unknown>)[]];

/** Preserve sequential dependencies and parallel closers; failures must not become a Done mark. */
export async function runShutdownStage(
  progress: ShutdownProgress,
  stage: ShutdownStage,
  steps: ShutdownStep[],
): Promise<void> {
  progress.advance(stage);
  let successful = true;
  for (const [name, actions] of steps) {
    trace(`shutdown ${name}: start`);
    const results = await Promise.allSettled(
      actions.map((action) => Promise.resolve().then(action)),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        successful = false;
        console.error('Service shutdown:', result.reason);
      }
    }
    trace(`shutdown ${name}: settled`);
  }
  if (successful) progress.complete(stage);
}
