import { createHash } from 'node:crypto';
import type { RuntimeModelHost } from '@skaro/timeline';
import type { RuntimeSession } from '../session.ts';
import type { RuntimeCommand, JournalRecord } from '../model.ts';
import { fingerprint } from '../verification/inputs.ts';
import { ModelTurnTimeline } from './turn-timeline.ts';
import { runPreparedHostModelTurn } from './host-turn.ts';
import { preparedModelTurn } from './host-schemas.ts';
import { ownerInputRecord } from './owner-input-record.ts';
import { OwnerSteering } from './owner-steering.ts';
import { ownerInputDisposition } from './owner-input-policy.ts';
import { refreshOwnerContext } from '../context/owner-context.ts';

/** Input admission uses RuntimeSession's queue; there is no new task scheduler or executor. */
export class OwnerModelTurns {
  work?: Promise<JournalRecord>;
  private readonly session: RuntimeSession;
  private readonly host: RuntimeModelHost;
  private readonly resume: () => AbortSignal;
  private readonly onFailure: (error: Error) => void;
  private steering?: OwnerSteering;
  constructor(
    session: RuntimeSession,
    host: RuntimeModelHost,
    resume: () => AbortSignal,
    onFailure: (error: Error) => void,
  ) {
    this.session = session;
    this.host = host;
    this.resume = resume;
    this.onFailure = onFailure;
  }

  async accept(command: RuntimeCommand): Promise<JournalRecord> {
    const { action } = command;
    this.host.signal?.throwIfAborted();
    if (action.type !== 'send' && action.type !== 'steer') throw new Error('Not an owner input');
    const delivery = ownerInputDisposition(
      action.input,
      action.type,
      !!this.work,
      !this.steering || this.steering.sealed,
    );
    if (delivery === 'skip')
      return this.session.journal.append(
        `cmd:${command.id}`,
        [],
        {
          value: { kind: 'owner-input-skipped', reason: 'no-active-turn' },
        },
        fingerprint(action),
      );
    if (delivery === 'busy') throw new Error('An owner model turn is already active');
    if (delivery === 'steer') return this.steering!.accept(command);
    if (delivery === 'wait') await this.work;
    const { state } = this.session.journal;
    if (
      Object.keys(state.interactions).length ||
      Object.values(state.effects).some((effect) => effect.state === 'pending')
    )
      throw new Error('An effect or interaction prevents owner input');
    const hostSignal = this.host.signal;
    hostSignal?.throwIfAborted();
    // Capture this generation before the durable write: interrupt during fsync must not be undone.
    const hash = fingerprint(action);
    const id = `owner-${createHash('sha256').update(command.id).digest('hex')}`;
    const timeline = new ModelTurnTimeline(this.session.journal, id, hash, `cmd:${command.id}`);
    const { input, facts } = ownerInputRecord(command, timeline.turnId);
    const signal = AbortSignal.any([this.resume(), ...(hostSignal ? [hostSignal] : [])]);
    await refreshOwnerContext(this.session, command.id, signal);
    signal.throwIfAborted();
    const steering = new OwnerSteering(this.session.journal, this.host.input, id, timeline.turnId);
    const acknowledged = await timeline.begin(facts, {
      value: { kind: 'owner-input', mode: input.mode, modelTurnId: id },
    });
    const work = runPreparedHostModelTurn(
      this.session,
      this.host,
      id,
      hash,
      async () => {
        signal.throwIfAborted();
        const value = await this.host.input!.prepare(input, signal);
        signal.throwIfAborted();
        preparedModelTurn.parse(value);
        await this.session.journal.append(
          `owner-request:${id}`,
          [],
          {
            value: {
              input: { sequence: acknowledged.sequence, hash: acknowledged.hash },
              ...value,
            },
          },
          fingerprint(value),
        );
        signal.throwIfAborted();
        return { type: 'modelTurn', ...value };
      },
      timeline,
      steering.apply,
    ).finally(() => {
      if (this.work === work) this.work = undefined;
    });
    this.work = work;
    this.steering = steering;
    void work.catch((error: unknown) =>
      this.onFailure(error instanceof Error ? error : new Error('Owner model journal failed')),
    );
    return acknowledged;
  }
}
