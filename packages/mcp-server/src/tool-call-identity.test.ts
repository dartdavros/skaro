import { expect, it } from 'vitest';
import { httpToolCallIdentity, internalToolCallIdentity } from './tool-call-identity.ts';

// Protocol metadata only: these tests do not start a server, register a project or replace tools.
const grant = 'c241b026-72bb-4733-8fb6-104df4847e2e';

it('deduplicates the same typed RPC ID only inside its own grant', () => {
  const first = httpToolCallIdentity(grant, 7);
  expect(httpToolCallIdentity(grant, 7)).toEqual(first);
  expect(httpToolCallIdentity(grant, '7').id).not.toBe(first.id);
  expect(httpToolCallIdentity('d0c2fcad-dbdb-4327-b4cc-d024759d9d90', 7).id).not.toBe(first.id);
  expect(httpToolCallIdentity(grant, 8).id).not.toBe(first.id);
  expect(first).toEqual({
    id: expect.stringMatching(/^mcp:http:[a-f0-9]{64}$/),
    transport: 'http',
    sourceId: grant,
  });
});

it('does not turn notifications into a shared retry identity', () => {
  const identities = [
    httpToolCallIdentity(grant, undefined),
    httpToolCallIdentity(grant, undefined),
    httpToolCallIdentity(grant, null),
    httpToolCallIdentity(grant, null),
  ];
  expect(new Set(identities.map((identity) => identity.id)).size).toBe(4);
  expect(identities.every((identity) => identity.sourceId === grant)).toBe(true);
  expect(() => httpToolCallIdentity(grant, Infinity)).toThrow('request identity');
  expect(() => httpToolCallIdentity(grant, NaN)).toThrow('request identity');
});

it('fences internal calls by session and generation without ambiguous delimiter concatenation', () => {
  const admission = { sessionId: 'session', generation: 1 };
  const first = internalToolCallIdentity(admission, 'call');
  expect(internalToolCallIdentity(admission, 'call')).toEqual(first);
  expect(internalToolCallIdentity({ ...admission, generation: 2 }, 'call').id).not.toBe(first.id);
  expect(internalToolCallIdentity({ ...admission, sessionId: 'another' }, 'call').id).not.toBe(
    first.id,
  );
  expect(internalToolCallIdentity(admission, 'another').id).not.toBe(first.id);
  expect(internalToolCallIdentity({ ...admission, sessionId: 'session:1' }, 'call').id).not.toBe(
    internalToolCallIdentity(admission, '1:call').id,
  );
  expect(first.transport).toBe('internal');
  expect(JSON.parse(first.sourceId)).toEqual(['session', 1]);
  expect(() => internalToolCallIdentity({ ...admission, generation: 0 }, 'call')).toThrow();
  expect(() => internalToolCallIdentity({ ...admission, generation: 1.5 }, 'call')).toThrow();
  expect(() => internalToolCallIdentity(admission, '')).toThrow();
});
