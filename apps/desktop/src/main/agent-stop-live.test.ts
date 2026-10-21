import { expect, it } from 'vitest';
import { CodexAdapter } from '@skaro/adapter-codex';
import { ClaudeAdapter } from '@skaro/adapter-claude';
import {
  operationTimeout,
  type AgentAdapter,
  type AgentSession,
  type TimelineEvent,
} from '@skaro/timeline';

const codex = process.env['SKARO_STOP_CODEX'];
const claude = process.env['SKARO_STOP_CLAUDE'];
const root = process.env['SKARO_STOP_ROOT'];

for (const agent of ['codex', 'claude-code'] as const) {
  const binary = agent === 'codex' ? codex : claude;
  it.skipIf(!root || !binary)(
    `${agent}: confirms interruption through the genuine installed runtime`,
    async () => {
      const adapter: AgentAdapter =
        agent === 'codex'
          ? new CodexAdapter({
              binary: async () => ({ binary: binary!, pathDirs: [] }),
              openUrl: () => {
                throw new Error('Interactive login is outside this check');
              },
            })
          : new ClaudeAdapter({ executable: async () => binary! });
      const events: TimelineEvent[] = [];
      let resolveStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        resolveStarted = resolve;
      });
      let session: AgentSession | undefined;
      try {
        session = await operationTimeout(
          adapter.start({
            cwd: root!,
            readOnly: true,
            permissionMode: 'ask',
            instructions:
              'Verification of interruption only. Never use tools, run commands, or change files.',
            raw: () => undefined,
            context: {
              now: Date.now,
              attachImage: () => {
                throw new Error('No image input in this check');
              },
            },
          }),
          45_000,
          'Native session startup timed out',
        );
        const draining = (async () => {
          for await (const event of session!.events) {
            events.push(event);
            if (event.t === 'turn.started') resolveStarted();
          }
        })();
        await session.send({
          text: 'Do not use any tools. Output the integers from 1 through 100000, one per line, without shortening the sequence.',
        });
        await operationTimeout(started, 30_000, 'The native turn did not start');
        if (agent === 'claude-code')
          await session.steer({
            text: 'Do not use tools. Continue the same sequence in the next turn.',
          });
        await operationTimeout(
          session.interrupt(),
          20_000,
          'The native interrupt was not confirmed',
        );
        const count = events.filter((event) => event.t === 'turn.started').length;
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
        expect(events.filter((event) => event.t === 'turn.started')).toHaveLength(count);
        if (agent === 'codex')
          expect(events).toContainEqual(
            expect.objectContaining({ t: 'turn.completed', outcome: 'interrupted' }),
          );
        expect(
          events.some(
            (event) =>
              event.t === 'item.upsert' &&
              ['command', 'file_change', 'tool'].includes(event.item.kind),
          ),
        ).toBe(false);
        await session.close();
        await operationTimeout(draining, 10_000, 'Native event stream did not finish');
      } finally {
        await session?.close();
      }
    },
    90_000,
  );
}
