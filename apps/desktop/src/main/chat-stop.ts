import { randomUUID } from 'node:crypto';
import { operationTimeout } from '@skaro/timeline';
import type { ChatEngine } from './chat-engine';
import type { LiveChat } from './chat-model';
import { blockOwnerMessages, cancelOwnerMessages, CommandCancelled } from './owner-commands';

/** Stop is an admission barrier, followed by native shutdown, never an optimistic idle flag. */
export function stopChat(ctx: ChatEngine, live: LiveChat): Promise<void> {
  if (live.stopping) return live.stopping;
  const { projectId, chat } = live;
  const unblock = blockOwnerMessages(
    projectId,
    chat.id,
    'Chat is stopping. Wait for confirmation.',
  );
  const requestId = randomUUID();
  const key = `chat.${chat.id}.stop`;
  const record = (state: string, error?: string) => {
    const value = { requestId, state, at: Date.now(), ...(error ? { error } : {}) };
    ctx.deps.db.setSetting(key, value);
    ctx.history.writeLine(live, {
      ts: Date.now() - chat.createdAt,
      dir: 'meta',
      line: { skaro: 'stop', ...value },
    });
  };
  const session = live.session;
  const work = (async () => {
    try {
      cancelOwnerMessages(projectId, chat.id);
      ctx.planningContinuation.stop(
        live,
        'Interrupted by the owner; resume only on explicit instruction.',
      );
      record('requested');
      live.operation.cancel(new CommandCancelled());
      live.grant?.revoke();
      live.grant = undefined;
      live.stopError = undefined;
      if (session) {
        try {
          await operationTimeout(session.interrupt(), 5000, 'Native interrupt deadline exceeded');
        } catch (error) {
          record('terminating', String(error));
        }
      }
      // Retire the transport as well: SDK queues/background work must not survive Stop.
      // NativeSession.close verifies owned process trees; the native thread ID stays resumable.
      await ctx.sessions.detach(live);
      for (const interaction of [...live.timeline.state.interactions]) {
        if (
          interaction.kind === 'approval' ||
          interaction.kind === 'question' ||
          interaction.kind === 'form' ||
          interaction.kind === 'login'
        )
          ctx.history.skaroEvent(live, {
            t: 'interaction.closed',
            id: interaction.id,
            resolution: 'expired',
          });
      }
      for (const turn of live.timeline.state.turns.filter((turn) => !turn.outcome))
        ctx.history.skaroEvent(live, {
          t: 'turn.completed',
          turnId: turn.id,
          outcome: 'interrupted',
        });
      record('confirmed');
      live.operation.renew();
    } catch (error) {
      live.stopError = String(error);
      record('failed', live.stopError);
      throw error;
    } finally {
      ctx.history.flush(live);
      ctx.listChanged(projectId, chat.id);
      unblock();
    }
  })();
  live.stopping = work.finally(() => {
    live.stopping = undefined;
  });
  return live.stopping;
}
