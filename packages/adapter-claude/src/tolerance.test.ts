import type { Emit, ProjectionContext } from '@skaro/timeline';
import { mutatedSessions, project } from '@skaro/timeline/tolerance';
import { describe, expect, it } from 'vitest';
import { ClaudeProjector } from './projector.ts';

const factory = (ctx: ProjectionContext, emit: Emit) => new ClaudeProjector(ctx, emit);

describe('Claude adapter tolerance (P3)', () => {
  it('turns unknown message types into unknown items', () => {
    const events = project(factory, [
      { dir: 'out', line: { type: 'brand_new_type', uuid: 'u1', payload: { x: 1 } } },
      { dir: 'out', line: { type: 'system', subtype: 'brand_new_subtype', uuid: 'u2' } },
    ]);
    const unknown = events.filter((e) => e.t === 'item.upsert' && e.item.kind === 'unknown');
    expect(unknown).toHaveLength(2);
  });

  it('survives malformed lines', () => {
    const garbage: unknown[] = [
      null,
      42,
      'not json',
      [],
      { type: 'assistant' },
      { type: 'assistant', message: null },
      { type: 'assistant', message: { content: 42 } },
      {
        type: 'assistant',
        message: { id: 1, content: [{ type: 'tool_use' }, null, 'x', { type: 'text', text: 5 }] },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 7, content: { a: 1 } }] },
      },
      { type: 'stream_event' },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 'a', delta: null } },
      { type: 'result', usage: 'x', is_error: 'yes' },
      { type: 'control_request', request_id: 1, request: { subtype: 'can_use_tool', input: null } },
      {
        type: 'control_request',
        request_id: 'r',
        request: { subtype: 'elicitation', requested_schema: [] },
      },
      { type: 'system', subtype: 'task_notification', task_id: null },
      { type: 'rate_limit_event', rate_limit_info: 5 },
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

  it.each(mutatedSessions('claude', 5).map((s) => [s.name, s] as const))(
    'replays damaged session %s',
    (_, s) => {
      expect(() => project(factory, s.lines)).not.toThrow();
    },
  );
});
