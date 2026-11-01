import type { RuntimeModelHost, RuntimeModelRequest } from '@skaro/timeline';
import type { RuntimeSession } from '../session.ts';
import type { ModelTurnAction } from '../model.ts';
import { fingerprint } from '../verification/inputs.ts';
import { modelBinding, requireModelBinding, requireModelHostPolicy } from './host-binding.ts';
import { executeChatTurn } from './chat-turn.ts';
import { executeNativeTurn } from './native-turn.ts';
import { ModelTextJournal } from './text-journal.ts';

export function busyHostModelTurn(session: RuntimeSession, id: string, action: ModelTurnAction) {
  const hash = fingerprint(action);
  const previous = session.journal.find(`cmd:${id}`);
  if (previous && previous.requestHash !== hash)
    throw new Error('Model turn identity reused for different input');
  return previous
    ? Promise.resolve(previous)
    : session.journal.append(
        `cmd:${id}`,
        [],
        { error: 'A native model turn is already active' },
        hash,
      );
}

/** Reuses the durable loops. Only the connector's privileged host can send a model request. */
export async function runHostModelTurn(
  session: RuntimeSession,
  host: RuntimeModelHost | undefined,
  id: string,
  action: ModelTurnAction,
) {
  const hash = fingerprint(action);
  const previous = session.journal.find(`cmd:${id}`);
  if (previous) {
    if (previous.requestHash !== hash)
      throw new Error('Model turn identity reused for different input');
    return previous;
  }
  try {
    const response = await perform(session, host, id, structuredClone(action));
    return session.journal.append(`cmd:${id}`, [], { value: response }, hash);
  } catch {
    return session.journal.append(
      `cmd:${id}`,
      [],
      { error: 'Native model turn did not complete; automatic replay forbidden' },
      hash,
    );
  }
}
async function perform(
  session: RuntimeSession,
  host: RuntimeModelHost | undefined,
  id: string,
  action: ModelTurnAction,
) {
  if (!host) throw new Error('Native model host is unavailable');
  const binding = modelBinding(host);
  requireModelBinding(session.journal.state.config!, binding);
  requireModelHostPolicy(host);
  const { request, maxSteps } = structuredClone(action);
  if (
    request.kind !== binding.policy.protocol ||
    fingerprint(request.value.route) !== fingerprint(binding.route)
  )
    throw new Error('Native model turn differs from its admitted route');
  const signal = host.signal ?? new AbortController().signal;
  let requestId = '';
  const text = new ModelTextJournal(session.journal, id);
  const admit = async (id: string, request: RuntimeModelRequest, signal: AbortSignal) => {
    const value = await host.reserve(id, request, signal);
    signal.throwIfAborted();
    const record = await session.journal.append(`budget:${id}`, [], { value });
    await session.journal.append(`${id}:dispatch`, [], {
      value: {
        kind: 'model-dispatch',
        requestHash: fingerprint(request),
        bindingHash: fingerprint(binding),
        reservation: { sequence: record.sequence, hash: record.hash },
      },
    });
    signal.throwIfAborted();
    requestId = id;
  };
  try {
    const common = {
      id,
      session,
      signal,
      maxSteps,
      toolAdmission: host.toolAdmission,
      onText: (delta: string) => text.write(delta),
    };
    const response =
      request.kind === 'chat'
        ? await executeChatTurn({
            ...common,
            request: request.value,
            admitRequest: (id, value, active) =>
              admit(id, { kind: 'chat', value }, active ?? signal),
            connector: {
              complete: async (value, signal, onText) => {
                const response = await host.complete(
                  requestId,
                  { kind: 'chat', value },
                  signal,
                  onText,
                );
                if (response.kind !== 'chat') throw new Error('Unexpected model protocol');
                return response.value;
              },
            },
          })
        : await executeNativeTurn({
            ...common,
            request: request.value,
            admitRequest: (id, value, active) =>
              admit(id, { kind: 'native', value }, active ?? signal),
            connector: {
              complete: async (value, signal, onText) => {
                const response = await host.complete(
                  requestId,
                  { kind: 'native', value },
                  signal,
                  onText,
                );
                if (response.kind !== 'native') throw new Error('Unexpected model protocol');
                return response.value;
              },
              continue: (request, response, results) =>
                host.continue!(request, response, results, signal),
            },
          });
    await text.close();
    return response;
  } finally {
    await text.close();
  }
}
