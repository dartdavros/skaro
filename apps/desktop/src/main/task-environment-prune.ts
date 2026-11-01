import { backgroundWork, freedResult } from './background-work';
import type { EnvironmentDocker } from './task-environment-docker';

/** Global pruning is never appropriate for a single-project verification run. */
export class EnvironmentPruning {
  private last = 0;
  async run(docker: EnvironmentDocker, stale: number, projectScope?: string) {
    if (projectScope || (!stale && Date.now() - this.last < 60 * 60_000)) return;
    this.last = Date.now();
    const job = backgroundWork.start('docker.prune');
    const { failures, reclaimed } = await docker.prune();
    if (failures.length) {
      console.error('Docker cleanup:', failures.join('; '));
      backgroundWork.fail(job, failures.join('; '));
    } else backgroundWork.finish(job, freedResult(reclaimed));
  }
}
