import type { RuntimeModelHost, RuntimeModelRequest } from '@skaro/timeline';
import type { RuntimeSession } from '../session.ts';
import type { ModelTurnAction } from '../model.ts';
import { fingerprint } from '../verification/inputs.ts';
import { modelBinding, requireModelBinding, requireModelHostPolicy } from './host-binding.ts';
import { executeChatTurn } from './chat-turn.ts';
import { executeNativeTurn } from './native-turn.ts';
import { ModelTextJournal } from './text-journal.ts';
import { ModelTurnTimeline } from './turn-timeline.ts';
import { RuntimeCommandRejected } from '../command-error.ts';
import type { ModelInputBoundary } from './owner-steering.ts';

export function busyHostModelTurn(session: RuntimeSession, id: string, action: ModelTurnAction) {
  const hash = fingerprint(action);
  const previous = session.journal.find(`cmd:${id}`);
  if (previous && previous.requestHash !== hash)
    throw new RuntimeCommandRejected('Model turn identity reused for different input');
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
  return runPreparedHostModelTurn(session, host, id, hash, async () => action);
}

/** Preparation never dispatches a model request; the same terminal/text lifecycle covers its failure. */
export async function runPreparedHostModelTurn(
  session: RuntimeSession,
  host: RuntimeModelHost | undefined,
  id: string,
  hash: string,
  prepare: () => Promise<ModelTurnAction>,
  timeline = new ModelTurnTimeline(session.journal, id, hash),
  boundary?: ModelInputBoundary,
) {
  const previous = session.journal.find(`cmd:${id}`);
  if (previous) {
    if (previous.requestHash !== hash)
      throw new RuntimeCommandRejected('Model turn identity reused for different input');
    return previous;
  }
  const text = new ModelTextJournal(session.journal, id, timeline.turnId);
  await timeline.begin();
  try {
    const response = await perform(
      session,
      host,
      id,
      structuredClone(await prepare()),
      text,
      boundary,
    );
    return session.journal.append(
      `cmd:${id}`,
      timeline.terminal('done'),
      { value: response },
      hash,
    );
  } catch {
    const interrupted = !!host?.signal?.aborted || session.modelAdmissionRevoked;
    await text.fail(interrupted);
    const error = 'Native model turn did not complete; automatic replay forbidden';
    return session.journal.append(
      `cmd:${id}`,
      timeline.terminal(interrupted ? 'interrupted' : 'failed', error),
      { error },
      hash,
    );
  }
}
async function perform(
  session: RuntimeSession,
  host: RuntimeModelHost | undefined,
  id: string,
  action: ModelTurnAction,
  text: ModelTextJournal,
  boundary?: ModelInputBoundary,
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
      onText: (delta: string, requestId: string) => text.write(requestId, delta),
    };
    const response =
      request.kind === 'chat'
        ? await executeChatTurn({
            ...common,
            request: request.value,
            boundary:
              boundary &&
              (async (request, final, signal) => {
                const next = await boundary({ kind: 'chat', value: request }, final, signal);
                if (next && next.kind !== 'chat') throw new Error('Steering protocol changed');
                return next?.value;
              }),
            onStep: (requestId, response, final) =>
              text.finishStep(requestId, response.message.content ?? '', final),
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
            boundary:
              boundary &&
              (async (request, final, signal, source) => {
                const next = await boundary(
                  { kind: 'native', value: request },
                  final,
                  signal,
                  source,
                );
                if (next && next.kind !== 'native') throw new Error('Steering protocol changed');
                return next?.value;
              }),
            onStep: (requestId, _response, final) => text.finishStep(requestId, undefined, final),
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
