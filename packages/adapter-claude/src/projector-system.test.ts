import {
  currentActivity,
  feedRows,
  Timeline,
  type Emit,
  type ProjectionContext,
} from '@skaro/timeline';
import { project } from '@skaro/timeline/tolerance';
import { expect, it } from 'vitest';
import { ClaudeProjector } from './projector.ts';

const factory = (ctx: ProjectionContext, emit: Emit) => new ClaudeProjector(ctx, emit);

it('reports broken servers of the session but not unsigned claude.ai account connectors', () => {
  const events = project(factory, [
    {
      dir: 'out',
      line: {
        type: 'system',
        subtype: 'init',
        session_id: 's1',
        model: 'claude-opus-5-5',
        mcp_servers: [
          { name: 'claude.ai Google Drive', status: 'needs-auth' },
          { name: 'skaro', status: 'failed' },
          { name: 'project-docs', status: 'needs-auth' },
          { name: 'playwright', status: 'connected' },
        ],
      },
    },
  ]);
  const notices = events.flatMap((e) =>
    e.t === 'item.upsert' && e.item.kind === 'notice' ? [e.item.text] : [],
  );
  expect(notices).toEqual(['skaro: failed', 'project-docs: needs-auth']);
});

it.each(['completed', 'failed'] as const)(
  'tracks native compaction while running and clears it when %s',
  (outcome) => {
    const timeline = new Timeline();
    const projector = new ClaudeProjector(
      {
        now: () => 1,
        attachImage: () => {
          throw new Error('Unexpected image');
        },
      },
      (event) => timeline.apply(event),
    );
    projector.input({ type: 'user', uuid: 'owner', message: { content: '/compact' } });
    projector.output({ type: 'system', subtype: 'status', status: 'compacting' });
    expect(currentActivity(timeline.state)).toBe('compacting_context');
    expect(feedRows(timeline.state).some((row) => row.type === 'notice')).toBe(false);
    expect(currentActivity(Timeline.restore(structuredClone(timeline.state)).state)).toBe(
      'compacting_context',
    );
    projector.output(
      outcome === 'completed'
        ? { type: 'system', subtype: 'compact_boundary', uuid: 'boundary' }
        : { type: 'system', subtype: 'status', compact_result: 'failed', compact_error: 'timeout' },
    );
    expect(currentActivity(timeline.state)).not.toBe('compacting_context');
    expect(timeline.state.items.find((item) => item.kind === 'notice')).toMatchObject({
      code: outcome === 'completed' ? 'compaction' : 'other',
      status: outcome === 'completed' ? 'done' : 'failed',
    });
    projector.output({ type: 'result', subtype: 'success', is_error: false });
    expect(currentActivity(timeline.state)).toBeUndefined();
  },
);
