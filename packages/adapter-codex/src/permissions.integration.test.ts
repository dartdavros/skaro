// Opt-in real-agent check: SKARO_CODEX_BINARY=<installed pinned binary> vitest run this file.
// Uses the actual signed-in app-server and a read-only network command, with no replacement APIs.
import { expect, it } from 'vitest';
import type { RawLine, TimelineEvent } from '@skaro/timeline';
import { CodexSession } from './session.ts';

const binary = process.env['SKARO_CODEX_BINARY'];

it.skipIf(!binary)(
  'applies full access to a real Codex turn waiting for approval',
  async () => {
    const raw: RawLine[] = [];
    const events: TimelineEvent[] = [];
    const session = new CodexSession(
      {
        cwd: process.cwd(),
        permissionMode: 'auto',
        sandboxVerified: true,
        effort: 'low',
        sandboxMode: process.platform === 'win32' ? 'unelevated' : undefined,
        raw: (line) => raw.push(line),
        context: {
          now: Date.now,
          attachImage: () => {
            throw new Error('unexpected image');
          },
        },
      },
      { binary: binary!, pathDirs: [] },
    );
    let switched = false;
    let changed: Promise<void> | undefined;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const completed = new Promise<void>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    const pump = (async () => {
      for await (const event of session.events) {
        events.push(event);
        if (
          event.t === 'interaction.opened' &&
          event.interaction.kind === 'approval' &&
          !switched
        ) {
          switched = true;
          changed = session.setPermissionMode('full');
          void changed.catch(reject);
        }
        if (event.t === 'turn.completed' && !event.continuing) {
          if (event.outcome === 'failed') reject(new Error(event.error?.message ?? 'agent failed'));
          else if (switched) resolve();
          else reject(new Error('The real agent finished without requesting approval'));
        }
      }
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await session.start();
      await session.send({
        text:
          'This is a read-only permission-switch verification. Run exactly one PowerShell command: ' +
          'Invoke-WebRequest -UseBasicParsing -Uri https://example.com | Select-Object -ExpandProperty StatusCode. ' +
          'Request escalated tool permission for the first execution, because network access is disabled ' +
          'in the sandbox. Do not read or change any project files. When the request succeeds, reply SWITCH_OK.',
      });
      await Promise.race([
        completed,
        new Promise<never>((_, fail) => {
          timer = setTimeout(() => fail(new Error('Real Codex verification timed out')), 180_000);
        }),
      ]);
      await changed;
      const starts = raw.filter(
        (line) => line.dir === 'in' && (line.line as { method?: string }).method === 'turn/start',
      );
      const params = starts.map(
        (line) => (line.line as { params: Record<string, unknown> }).params,
      );
      expect(params).toHaveLength(2);
      expect(params[1]).toMatchObject({
        threadId: params[0]!['threadId'],
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'dangerFullAccess' },
      });
      expect(events).toContainEqual(
        expect.objectContaining({ t: 'turn.completed', outcome: 'interrupted', continuing: true }),
      );
      expect(
        events.filter((e) => e.t === 'interaction.opened' && e.interaction.kind === 'approval'),
      ).toHaveLength(1);
      expect(
        events.some(
          (e) =>
            e.t === 'item.upsert' &&
            e.item.kind === 'message' &&
            e.item.role === 'agent' &&
            e.item.text.includes('SWITCH_OK'),
        ),
      ).toBe(true);
    } finally {
      clearTimeout(timer);
      await session.close();
      await pump;
    }
  },
  210_000,
);
