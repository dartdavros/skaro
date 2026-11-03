import type {
  RuntimeModelInputPort,
  RuntimeModelRequest,
  RuntimeModelResponse,
  RuntimeOwnerInput,
} from '@skaro/timeline';
import type { RuntimeJournal } from '../journal.ts';
import type { JournalRecord, RuntimeCommand } from '../model.ts';
import { ownerInputRecord } from './owner-input-record.ts';
import { fingerprint } from '../verification/inputs.ts';
import { modelInvocation } from './host-schemas.ts';

export type ModelInputBoundary = (
  request: RuntimeModelRequest,
  final: boolean,
  signal: AbortSignal,
  terminalRequestId?: string,
) => Promise<RuntimeModelRequest | undefined>;

/** Queue owner facts inside the current turn; apply only after the current model/tool boundary. */
export class OwnerSteering {
  sealed = false;
  private readonly journal: RuntimeJournal;
  private readonly input: Pick<RuntimeModelInputPort, 'steer'> | undefined;
  private readonly modelId: string;
  private readonly turnId: string;
  private readonly pending: Promise<{ input: RuntimeOwnerInput; record: JournalRecord }>[] = [];
  constructor(
    journal: RuntimeJournal,
    input: Pick<RuntimeModelInputPort, 'steer'> | undefined,
    modelId: string,
    turnId: string,
  ) {
    this.journal = journal;
    this.input = input;
    this.modelId = modelId;
    this.turnId = turnId;
  }
  accept(command: RuntimeCommand) {
    if (this.sealed || !this.input?.steer || this.pending.length >= 32)
      throw new Error('Active owner turn does not admit another steering input');
    const { input, facts } = ownerInputRecord(command, this.turnId);
    const committed = this.journal
      .append(
        `cmd:${command.id}`,
        facts,
        {
          value: { kind: 'owner-input', mode: 'steer', modelTurnId: this.modelId },
        },
        fingerprint(command.action),
      )
      .then((record) => ({ input, record }));
    // Reserve before the fsync completes so a concurrent final response cannot lose this input.
    this.pending.push(committed);
    void committed.catch(() => undefined);
    return committed.then(({ record }) => record);
  }
  readonly apply: ModelInputBoundary = async (request, final, signal, terminalRequestId) => {
    signal.throwIfAborted();
    const pending = this.pending.splice(0);
    if (!pending.length) {
      if (final) this.sealed = true;
      return undefined;
    }
    let current = structuredClone(request);
    let terminal = terminalRequestId;
    for (const value of pending) {
      const { input, record } = await value;
      signal.throwIfAborted();
      const response = terminal && this.journal.find(`${terminal}:result`)?.result.value;
      if (terminal && !response) throw new Error('Steering has no durable terminal response');
      const source = terminal
        ? {
            requestId: terminal,
            response: { kind: current.kind, value: response } as RuntimeModelResponse,
          }
        : undefined;
      current = await this.input!.steer!(input, current, source, signal);
      signal.throwIfAborted();
      modelInvocation.shape.request.parse(current);
      if (
        current.kind !== request.kind ||
        fingerprint(current.value.route) !== fingerprint(request.value.route)
      )
        throw new Error('Steering cannot change its model route');
      await this.journal.append(
        `owner-steer:${input.commandId}`,
        [],
        {
          value: { input: { sequence: record.sequence, hash: record.hash }, request: current },
        },
        fingerprint(current),
      );
      terminal = undefined;
    }
    return current;
  };
}
