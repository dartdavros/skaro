import assert from 'node:assert/strict';
import {
  continueContextChatRequest,
  latestContext,
  type readRuntimeJournal,
} from '@skaro/agent-runtime';
import type { RuntimeModelRequest } from '@skaro/timeline';
import type { TaskStopReview } from './task-stop-review';
import { requireTaskStopInputs, requireTaskStopRequest } from './task-stop-input';

export const taskStopPins = (reviewed: TaskStopReview) => [
  {
    id: 'task-stop-owner-instructions',
    kind: 'constraint' as const,
    origin: 'host' as const,
    revision: 'task-stop-owner-instructions-v1',
    text: reviewed.wireComposition.instructions,
  },
];

/** Reconstruct the actual formatter envelope from the verified primary chain, not model text. */
export function requireTaskStopEnvelope(
  journal: Awaited<ReturnType<typeof readRuntimeJournal>>,
  request: RuntimeModelRequest,
  reviewed: TaskStopReview,
) {
  assert.equal(request.kind, 'chat');
  if (request.kind !== 'chat') throw new Error('Task Stop requires Chat protocol');
  const context = latestContext(journal);
  assert(context);
  assert.deepEqual(context.snapshot.pins, taskStopPins(reviewed));
  assert.deepEqual(
    context.snapshot.sources.map(({ path, exactText, kind }) => ({ path, text: exactText, kind })),
    reviewed.wireComposition.contextDocuments.map((source) => ({
      ...source,
      kind: 'scope-instructions',
    })),
  );
  const inputs = journal.records
    .flatMap((record) => record.facts)
    .filter((fact) => fact.type === 'input');
  requireTaskStopInputs(reviewed, inputs);
  assert(
    !journal.records.some((record) =>
      record.facts.some((fact) =>
        ['answer', 'rewind', 'tool-request', 'interaction'].includes(fact.type),
      ),
    ),
    'Unexpected workflow data',
  );
  const expected = continueContextChatRequest(
    { journal },
    {
      route: reviewed.wireComposition.route,
      price: { prompt: 0.5, completion: 2, request: 0 },
      tools: [],
      messages: [{ role: 'user', content: inputs.at(-1)!.input.text }],
    },
  );
  requireTaskStopRequest(request.value, expected);
}
