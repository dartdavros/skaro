import assert from 'node:assert/strict';
import { RuntimeSession, continueContextChatRequest } from '@skaro/agent-runtime';
import type { RuntimeProcessIdentity } from '@skaro/timeline';
import { longContextConfig } from '../credentials/long-context-config';

/** Resume the actual accepted model session; never seed/copy a captured provider response. */
export async function verifyOwnerContext(directory: string, owner: RuntimeProcessIdentity) {
  const session = await RuntimeSession.open(longContextConfig(directory), owner);
  try {
    const existing = session.journal.find('proof:owner-context');
    if (existing) return existing.result.value;
    assert(session.journal.find('proof:long-context'), 'Real long-session acceptance is required');
    const route = session.journal.state.config!.route;
    const request = {
      route,
      price: { prompt: 0.15, completion: 0.6 },
      messages: [{ role: 'user' as const, content: 'Продолжай.' }],
    };
    const before = structuredClone(session.journal.records);
    assert(
      continueContextChatRequest(session, request).messages.some(
        (message) => message.role === 'assistant',
      ),
      'Genuine native continuation is required',
    );
    await session.execute({
      id: 'ba5-owner-boundary',
      action: { type: 'send', input: { text: 'добей этот этап' } },
    });
    const next = continueContextChatRequest(session, request);
    assert(next.messages[0]!.content!.includes('добей этот этап'));
    assert(
      next.messages.every((message) => message.role !== 'assistant' && message.role !== 'tool'),
    );
    assert.deepEqual(session.journal.records.slice(0, before.length), before);
    assert.equal(
      session.journal.records
        .flatMap((record) => record.facts)
        .filter((fact) => fact.type === 'effect-intent').length,
      before.flatMap((record) => record.facts).filter((fact) => fact.type === 'effect-intent')
        .length,
    );
    const proof = {
      actualNativeHistory: true,
      exactNewOwnerInput: true,
      staleSystemFrameRejected: true,
      originalRecordsPreserved: true,
      modelRequests: 0,
    };
    await session.journal.append('proof:owner-context', [], { value: proof });
    return proof;
  } finally {
    await session.dispose();
  }
}
