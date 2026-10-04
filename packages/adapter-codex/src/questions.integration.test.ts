// Opt-in verification against the actual signed-in, pinned Codex app-server and provider API.
import { expect, it } from 'vitest';
import type { RawLine } from '@skaro/timeline';
import { CodexSession } from './session.ts';

const binary = process.env['SKARO_CODEX_BINARY'];

it.skipIf(!binary)(
  'answers a real structured question without an unstable-feature warning in Default mode',
  async () => {
    const raw: RawLine[] = [];
    let answered = false;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const completed = new Promise<void>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    const session = new CodexSession(
      {
        cwd: process.cwd(),
        permissionMode: 'full',
        effort: 'low',
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
    const pump = (async () => {
      for await (const event of session.events) {
        if (event.t === 'interaction.opened') {
          if (event.interaction.kind !== 'question') {
            reject(new Error(`Unexpected interaction: ${event.interaction.kind}`));
            continue;
          }
          const question = event.interaction.questions[0]!;
          answered = true;
          await session.respond(event.interaction.id, {
            kind: 'question',
            answers: { [question.id]: [question.options[0]!.label] },
          });
        }
        if (event.t === 'turn.completed') {
          if (event.outcome === 'failed') reject(new Error(event.error?.message ?? 'agent failed'));
          else if (!answered) reject(new Error('Agent finished without a structured question'));
          else resolve();
        }
      }
    })().catch(reject);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await session.start();
      await session.send({
        text:
          'Verify the structured-question transport. Use request_user_input exactly once with ' +
          'one question asking me to choose FIRST or SECOND. This test explicitly requires a ' +
          'question card, not a text question. Do not run commands, access other tools or change ' +
          'files. After receiving the answer, reply with that selected label and finish.',
      });
      await Promise.race([
        completed,
        new Promise<never>((_, fail) => {
          timer = setTimeout(
            () => fail(new Error('Real Codex question verification timed out')),
            60_000,
          );
        }),
      ]);
      expect(answered).toBe(true);
      expect(
        raw.some((line) =>
          JSON.stringify(line.line).includes('Under-development features enabled:'),
        ),
      ).toBe(false);
      expect(
        raw.some(
          (line) =>
            line.dir === 'out' &&
            (line.line as { method?: string }).method === 'item/tool/requestUserInput',
        ),
      ).toBe(true);
    } finally {
      clearTimeout(timer);
      await session.close();
      await pump;
    }
  },
  90_000,
);
