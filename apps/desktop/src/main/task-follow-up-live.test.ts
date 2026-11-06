import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { CodexSession } from '@skaro/adapter-codex';
import type { Interaction, RawLine, TimelineEvent } from '@skaro/timeline';
import { taskAgentInput } from './task-agent-input';

const profile = process.env['SKARO_FOLLOW_UP_PROFILE'];
const binary = process.env['SKARO_CODEX_BINARY'];

// Opt-in native-provider check in the registered Cat-pilot, without touching the running app.
it.skipIf(!profile || !binary)(
  'ends a conversational follow-up, then waits for an actual option-card answer',
  async () => {
    const registry = new DatabaseSync(join(profile!, 'skaro.db'), { readOnly: true });
    let cwd: string;
    try {
      const projects = registry
        .prepare('SELECT path FROM projects WHERE name=? COLLATE NOCASE')
        .all('Cat-pilot');
      expect(projects).toHaveLength(1);
      cwd = String(projects[0]!['path']);
    } finally {
      registry.close();
    }
    const events: TimelineEvent[] = [];
    const raw: RawLine[] = [];
    const waiters = new Set<() => void>();
    const until = async (predicate: () => boolean) => {
      const deadline = Date.now() + 60_000;
      while (!predicate()) {
        if (Date.now() >= deadline) throw new Error('Native follow-up verification timed out');
        await new Promise<void>((resolve) => {
          const notify = () => {
            clearTimeout(timer);
            waiters.delete(notify);
            resolve();
          };
          const timer = setTimeout(notify, 1000);
          waiters.add(notify);
        });
      }
    };
    const session = new CodexSession(
      {
        cwd,
        permissionMode: 'full',
        readOnly: true,
        effort: 'low',
        raw: (line) => raw.push(line),
        context: {
          now: Date.now,
          attachImage: () => {
            throw new Error('Unexpected image');
          },
        },
      },
      { binary: binary!, pathDirs: [] },
    );
    const pump = (async () => {
      for await (const event of session.events) {
        events.push(event);
        for (const notify of [...waiters]) notify();
      }
    })();
    const completed = () => events.filter((event) => event.t === 'turn.completed');
    try {
      await session.start();
      await session.send(
        taskAgentInput(
          {
            commandId: 'native-follow-up-question',
            text: 'Это только вопрос, не поручение выполнять задачу. Почему для проверки восстановления нужны реальные резервные копии? Ответь одним предложением. Не читай и не меняй файлы, не выполняй команды и не запускай проверку.',
          },
          undefined,
          true,
        ),
      );
      await until(() => completed().length === 1);
      expect(completed()[0]).toMatchObject({ outcome: 'done' });
      expect(events.some((event) => event.t === 'interaction.opened')).toBe(false);
      const boundary = events.length;
      await session.send(
        taskAgentInput(
          {
            commandId: 'native-follow-up-decision',
            text: 'Нужно моё решение о следующем действии: только объяснить порядок проверки или отложить проверку. Выбирать за меня нельзя. Запроси решение с этими двумя вариантами и дождись моего ответа. Это проверка общения: не выполняй исходную задачу, не читай и не меняй файлы, не запускай команды. После ответа напиши только DECISION_RECEIVED и закончи.',
          },
          undefined,
          true,
        ),
      );
      await until(
        () =>
          events.slice(boundary).some((event) => event.t === 'interaction.opened') ||
          completed().length > 1,
      );
      const opened = events.slice(boundary).find((event) => event.t === 'interaction.opened');
      expect(opened?.t).toBe('interaction.opened');
      const question = (opened as Extract<TimelineEvent, { t: 'interaction.opened' }>).interaction;
      expect(question.kind).toBe('question');
      const card = question as Extract<Interaction, { kind: 'question' }>;
      expect(card.questions).toHaveLength(1);
      expect(card.questions[0]!.options.length).toBeGreaterThanOrEqual(2);
      expect(card.delivery).not.toBe('async');
      // Real blocking RPC stays unanswered; no model completion or further work is accepted.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      expect(completed()).toHaveLength(1);
      expect(
        events
          .slice(boundary)
          .filter(
            (event) =>
              event.t === 'item.upsert' &&
              ['command', 'file_change', 'tool'].includes(event.item.kind),
          ),
      ).toEqual([]);
      await session.respond(card.id, {
        kind: 'question',
        answers: { [card.questions[0]!.id]: [card.questions[0]!.options[0]!.label] },
      });
      await until(() => completed().length === 2);
      expect(completed()[1]).toMatchObject({ outcome: 'done' });
      expect(JSON.stringify(events.slice(boundary))).toContain('DECISION_RECEIVED');
      expect(
        raw.some(
          (line) =>
            line.dir === 'out' &&
            (line.line as { method?: string }).method === 'item/tool/requestUserInput',
        ),
      ).toBe(true);
    } finally {
      await session.close();
      await pump;
    }
  },
  150_000,
);
