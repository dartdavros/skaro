import assert from 'node:assert/strict';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import type {
  AgentSession,
  ChatResponse,
  RuntimeModelRequest,
  BuiltinSessionStart,
} from '@skaro/timeline';

/** Drive the real ordinary send path or the earlier internal model port; never inject a response. */
export async function nativePlanTurn(
  session: AgentSession,
  config: BuiltinSessionStart,
  request: RuntimeModelRequest,
  hash: string,
  ownerInput: boolean,
  waitForTerminal: (turnId: string) => Promise<void>,
) {
  if (!ownerInput) {
    assert('runModelTurn' in session && typeof session.runModelTurn === 'function');
    const id = `nativeplan-${hash.slice(0, 16)}-v2`;
    const response = (await session.runModelTurn(request, id, 6)) as ChatResponse;
    const run = session.runModelTurn.bind(session);
    return { id, response, duplicate: () => run(request, id, 6) };
  }
  assert(request.kind === 'chat');
  const input = { text: request.value.messages[0]!.content! };
  // send must acknowledge durable input promptly; completion arrives through canonical events.
  await session.send(input);
  const journal = await readRuntimeJournal(config.journalPath, config.sessionId);
  const ack = journal.records.findLast(
    (record) => (record.result.value as { kind?: string } | undefined)?.kind === 'owner-input',
  );
  assert(ack && !ack.result.error);
  const id = (ack.result.value as { modelTurnId: string }).modelTurnId;
  const fact = ack.facts.find((fact) => fact.type === 'input');
  assert(fact?.type === 'input');
  assert.deepEqual(fact.input, input);
  await waitForTerminal(fact.turnId);
  const final = await readRuntimeJournal(config.journalPath, config.sessionId);
  const result = final.records.find((record) => record.id === `cmd:${id}`);
  assert(result && !result.result.error, 'Ordinary owner model turn did not complete');
  const response = result.result.value as ChatResponse;
  assert('deliverInput' in session && typeof session.deliverInput === 'function');
  const deliver = session.deliverInput.bind(session);
  return {
    id,
    response,
    duplicate: async () => {
      await deliver(input, ack.id.slice('cmd:'.length), 'send');
      return response;
    },
  };
}
