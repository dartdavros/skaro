import type { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { errorText } from './session-log';
import { retireNativeSession } from './native/session-retirement';
import { untilCancelled } from './task-session-cancellation';

/** Suspension, input replacement and Stop all join the teardown of the same transport. */
export async function detachTaskSession(ctx: TaskRunEngine, active: ActiveRun, keepSlot: boolean) {
  active.sessionStartup?.abort(new Error('Task detached during startup'));
  active.detaching ??= retireTaskTransport(ctx, active).finally(() => {
    active.detaching = undefined;
  });
  try {
    await active.detaching;
  } finally {
    if (!keepSlot) {
      active.release?.();
      active.release = undefined;
    }
  }
}

async function retireTaskTransport(ctx: TaskRunEngine, active: ActiveRun) {
  await active.attaching?.catch(() => undefined);
  const session = active.session ?? active.retiringSession;
  active.session = undefined;
  active.retiringSession = session;
  active.grant?.revoke();
  active.grant = undefined;
  try {
    await retireNativeSession(active, 'Task session detached', async () => {
      try {
        await ctx.processes.stop(active.run.id);
      } finally {
        await session?.close();
      }
    });
    active.retiringSession = undefined;
    await drainRetiredEvents(active);
  } catch (error) {
    active.stopError = errorText(error);
    throw error;
  } finally {
    ctx.history.flush(active);
  }
}

/** Only drain after closing the transport and verifying its processes. Never cancel a successor's reader. */
export async function drainRetiredEvents({
  pumping,
  eventReader,
}: Pick<ActiveRun, 'pumping' | 'eventReader'>) {
  if (!pumping) return;
  const grace = AbortSignal.timeout(2000);
  try {
    await untilCancelled(pumping, grace);
  } catch (error) {
    if (!eventReader || !grace.aborted || error !== grace.reason) throw error;
    eventReader.abort(error);
    await pumping;
  }
}
