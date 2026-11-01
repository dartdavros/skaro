import { createHash } from 'node:crypto';
import type { RuntimeModelHost, RuntimeOwnerInput } from '@skaro/timeline';
import type { RuntimeSession } from '../session.ts';
import type { RuntimeCommand, JournalRecord } from '../model.ts';
import { fingerprint } from '../verification/inputs.ts';
import { ModelTurnTimeline } from './turn-timeline.ts';
import { runPreparedHostModelTurn } from './host-turn.ts';
import { preparedModelTurn } from './host-schemas.ts';

/** Input admission uses RuntimeSession's queue; there is no new task scheduler or executor. */
export class OwnerModelTurns {
  work?: Promise<JournalRecord>;
  private readonly session: RuntimeSession;
  private readonly host: RuntimeModelHost;
  private readonly resume: () => AbortSignal;
  private readonly onFailure: (error: Error) => void;
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
    if (action.type !== 'send' && action.type !== 'steer') throw new Error('Not an owner input');
    if (this.work) throw new Error('Active owner turn requires a verified steering boundary');
    const { state } = this.session.journal;
    if (
      Object.keys(state.interactions).length ||
      Object.values(state.effects).some((effect) => effect.state === 'pending')
    )
      throw new Error('An effect or interaction prevents owner input');
    if (!action.input.text.trim() && !action.input.images?.length)
      throw new Error('Input is empty');
    if (action.input.images?.length)
      throw new Error('Image input requires a verified model connector');
    if (Buffer.byteLength(JSON.stringify(action.input)) > 262_144)
      throw new Error('Owner input exceeds the admitted size');
    const hostSignal = this.host.signal;
    hostSignal?.throwIfAborted();
    // Capture this generation before the durable write: interrupt during fsync must not be undone.
    const signal = AbortSignal.any([this.resume(), ...(hostSignal ? [hostSignal] : [])]);
    const hash = fingerprint(action);
    const id = `owner-${createHash('sha256').update(command.id).digest('hex')}`;
    const timeline = new ModelTurnTimeline(this.session.journal, id, hash, `cmd:${command.id}`);
    const input: RuntimeOwnerInput = {
      commandId: command.id,
      id: `input-${command.id}`,
      turnId: timeline.turnId,
      mode: action.type,
      input: structuredClone(action.input),
      timestamp: Date.now(),
    };
    const acknowledged = await timeline.begin(
      [
        {
          type: 'input',
          id: input.id,
          turnId: input.turnId,
          input: input.input,
          timestamp: input.timestamp,
        },
        {
          type: 'timeline',
          event: {
            t: 'item.upsert',
            item: {
              id: input.id,
              turnId: input.turnId,
              startedAt: input.timestamp,
              status: 'done',
              kind: 'message',
              role: 'user',
              text: input.input.text,
              native: { agent: 'skaro', type: 'input', ref: input.id },
            },
          },
        },
      ],
      { value: { kind: 'owner-input', mode: input.mode, modelTurnId: id } },
    );
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
    ).finally(() => {
      if (this.work === work) this.work = undefined;
    });
    this.work = work;
    void work.catch((error: unknown) =>
      this.onFailure(error instanceof Error ? error : new Error('Owner model journal failed')),
    );
    return acknowledged;
  }
}
