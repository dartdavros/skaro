import assert from 'node:assert/strict';
import {
  operationTimeout,
  type AgentSession,
  type ChatResponse,
  type TimelineEvent,
} from '@skaro/timeline';
import { readRuntimeJournal } from '@skaro/agent-runtime';

/** Stable input ID prevents a repeated CLI invocation from retrying an earlier failed POST. */
export function configuredPlanTurn(
  journalPath: string,
  sessionId: string,
  hash: string,
  text: string,
) {
  const finished = new Set<string>();
  const waiters = new Map<string, () => void>();
  return {
    observe(event: TimelineEvent) {
      if (event.t !== 'turn.completed') return;
      finished.add(event.turnId);
      waiters.get(event.turnId)?.();
    },
    async run(session: AgentSession) {
      assert('deliverInput' in session && typeof session.deliverInput === 'function');
      const commandId = `configured-${hash.slice(0, 32)}`;
      const input = { text };
      await session.deliverInput(input, commandId, 'send');
      const initial = await readRuntimeJournal(journalPath, sessionId);
      const ack = initial.records.find((record) => record.id === `cmd:${commandId}`)!;
      const fact = ack.facts.find((fact) => fact.type === 'input');
      assert(fact?.type === 'input');
      assert.deepEqual(fact.input, input);
      const id = (ack.result.value as { modelTurnId: string }).modelTurnId;
      await operationTimeout(
        new Promise<void>((resolve) => {
          if (finished.has(fact.turnId)) resolve();
          else waiters.set(fact.turnId, resolve);
        }),
        120_000,
        'Configured owner plan did not finish',
      );
      const journal = await readRuntimeJournal(journalPath, sessionId);
      const result = journal.records.find((record) => record.id === `cmd:${id}`)!;
      assert(
        result && !result.result.error,
        'Configured model plan did not complete; do not retry automatically',
      );
      const response = result.result.value as ChatResponse;
      assert.equal(response.finishReason, 'stop');
      await session.deliverInput(input, commandId, 'send');
      assert.equal(
        (await readRuntimeJournal(journalPath, sessionId)).records.length,
        journal.records.length,
      );
      return { id, response, journal };
    },
  };
}
