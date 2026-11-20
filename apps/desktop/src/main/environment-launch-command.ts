import { runShell } from '@skaro/core';
import { EnvironmentCommandFailed } from './environment-dispatch-error';

/** The shell may have created Docker objects even when its exit status is nonzero. */
export async function runEnvironmentCommand(
  command: string,
  options: Parameters<typeof runShell>[1],
  recordObjects: () => Promise<void>,
) {
  let dispatched = false;
  try {
    await runShell(command, {
      ...options,
      processStarted(pid) {
        dispatched = true;
        return options.processStarted?.(pid);
      },
    });
  } catch (error) {
    if (dispatched) {
      try {
        await recordObjects();
      } catch (inspection) {
        throw new EnvironmentCommandFailed(
          new AggregateError(
            [error, inspection],
            `${String(error)}\nDocker inventory: ${String(inspection)}`,
          ),
        );
      }
    }
    throw new EnvironmentCommandFailed(error);
  }
  await recordObjects();
}
