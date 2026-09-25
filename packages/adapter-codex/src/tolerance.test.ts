import type { Emit, ProjectionContext } from '@skaro/timeline';
import { mutatedSessions, project } from '@skaro/timeline/tolerance';
import { describe, expect, it } from 'vitest';
import { CodexProjector } from './projector.ts';

const factory = (ctx: ProjectionContext, emit: Emit) => new CodexProjector(ctx, emit);

describe('Codex adapter tolerance (P3)', () => {
  it('turns unknown notifications, items and server requests into unknown items', () => {
    const events = project(factory, [
      { dir: 'out', line: { method: 'brand/new/notification', params: { a: 1 } } },
      {
        dir: 'out',
        line: { method: 'item/completed', params: { item: { type: 'brandNewItem', id: 'x' } } },
      },
      { dir: 'out', line: { id: 9, method: 'brand/new/request', params: {} } },
    ]);
    const unknown = events.filter((e) => e.t === 'item.upsert' && e.item.kind === 'unknown');
    expect(unknown).toHaveLength(3);
  });

  it('survives malformed lines', () => {
    const garbage: unknown[] = [
      null,
      42,
      'not json',
      { method: 5 },
      { method: 'turn/started' },
      { method: 'turn/completed', params: { turn: 'x' } },
      {
        method: 'item/started',
        params: { item: { type: 'commandExecution', commandActions: 'x' } },
      },
      {
        method: 'item/completed',
        params: { item: { type: 'fileChange', changes: [null, 1, { kind: 5 }] } },
      },
      { method: 'item/agentMessage/delta', params: { itemId: null, delta: 7 } },
      { method: 'turn/plan/updated', params: { plan: { step: 1 } } },
      { method: 'thread/tokenUsage/updated', params: { tokenUsage: [] } },
      { method: 'account/rateLimits/updated', params: { rateLimits: { primary: 'x' } } },
      {
        id: 1,
        method: 'item/tool/requestUserInput',
        params: { questions: [null, { options: 5 }] },
      },
      { id: 2, method: 'mcpServer/elicitation/request', params: { requestedSchema: 'x' } },
      { id: 3, result: null },
    ];
    expect(() =>
      project(
        factory,
        garbage.map((line) => ({ dir: 'out' as const, line })),
      ),
    ).not.toThrow();
    expect(() =>
      project(
        factory,
        garbage.map((line) => ({ dir: 'in' as const, line })),
      ),
    ).not.toThrow();
  });

  it.each(mutatedSessions('codex', 5).map((s) => [s.name, s] as const))(
    'replays damaged session %s',
    (_, s) => {
      expect(() => project(factory, s.lines)).not.toThrow();
    },
  );
});
