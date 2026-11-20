import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_FOLLOW_UP_PROFILE'];
const project = process.env['SKARO_VERIFICATION_PROJECT'];
const root = process.env['SKARO_E2E_WRITE_PROJECT_ROOT'];
const task = process.env['SKARO_CHAT_CONCURRENCY_TASK'] ?? '';
const worktree = process.env['SKARO_CHAT_CONCURRENCY_WORKTREE'] === '1';
test.skip(
  !profile || !project || !root || !task,
  'Requires a designated Cat-pilot task and signed-in Codex',
);

test('a running task observes a file written by a concurrent project chat', async () => {
  test.setTimeout(300_000);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const receipt = `skaro-chat-verification-${randomUUID()}.txt`;
  const path = join(root!, receipt);
  expect(existsSync(path)).toBe(false);
  const app = await launchApp(profile!, { openSavedProject: false });
  let taskSent = false;
  let restoreArchive = false;
  let chatId: string | undefined;
  try {
    const page = await app.firstWindow();
    const readTask = () =>
      page.evaluate(([id, task]) => window.skaro.invoke('task.open', id, task), [
        project!,
        task,
      ] as const);
    const before = await readTask();
    expect(before.run?.agent).toBe('codex');
    expect(!!before.run?.worktree).toBe(worktree);
    expect(before.run?.live).toBe(false);
    expect(before.timeline?.interactions.filter((i) => i.kind !== 'merge')).toEqual([]);
    if (before.task.archived) {
      expect(process.env['SKARO_CHAT_CONCURRENCY_UNARCHIVE']).toBe(task);
      restoreArchive = true;
      await page.evaluate(([id, task]) => window.skaro.invoke('tasks.archive', id, [task], false), [
        project!,
        task,
      ] as const);
    }
    const previous = new Set(before.timeline?.items.map((i) => i.id));
    const taskCommand = randomUUID();
    await page.evaluate(
      ({ id, task, commandId, text }) =>
        window.skaro.invoke('task.send', id, task, { text, commandId }),
      {
        id: project!,
        task,
        commandId: taskCommand,
        text: `Проверка параллельной записи из общего чата. Выполни одну команду, которая до 150 секунд ожидает появления файла ${path}, затем читает его и печатает содержимое. Не создавай и не изменяй файлы. В ответе назови прочитанный SHA. Не продолжай реализацию задачи и не меняй её статус.`,
      },
    );
    taskSent = true;
    await expect
      .poll(
        async () => {
          const view = await readTask();
          const added = view.timeline?.items.filter((i) => !previous.has(i.id));
          const failure = added?.find((i) => i.kind === 'notice' && i.level === 'error');
          if (failure?.kind === 'notice') throw new Error(failure.text);
          return added?.some((i) => i.kind === 'command' && i.status === 'running');
        },
        { timeout: 90_000 },
      )
      .toBe(true);
    const chat = await page.evaluate(
      ({ id, commandId }) =>
        window.skaro.invoke(
          'chat.create',
          id,
          { agent: 'codex', effort: 'low', permissionMode: 'full' },
          { text: 'Ответь одним словом «Готов». Никаких действий не требуется.', commandId },
        ),
      { id: project!, commandId: randomUUID() },
    );
    chatId = chat.id;
    const readChat = () =>
      page.evaluate(([id, chat]) => window.skaro.invoke('chat.open', id, chat), [
        project!,
        chat.id,
      ] as const);
    await expect
      .poll(async () => (await readChat()).timeline.turns.at(-1)?.outcome, { timeout: 90_000 })
      .toBe('done');
    expect(
      (await readChat()).timeline.items.some(
        (i) => i.kind === 'message' && i.role === 'agent' && /готов/i.test(i.text),
      ),
    ).toBe(true);
    expect(
      (await readTask()).timeline?.items.some(
        (i) => !previous.has(i.id) && i.kind === 'command' && i.status === 'running',
      ),
    ).toBe(true);
    await page.evaluate(
      ({ id, chat, text, commandId }) =>
        window.skaro.invoke('chat.send', id, chat, { text, commandId }),
      {
        id: project!,
        chat: chat.id,
        commandId: randomUUID(),
        text: `Определи полный текущий Git HEAD проекта и запиши его в новый файл ${receipt} в основной рабочей папке, одной строкой в UTF-8. Больше ничего не меняй. Заверши ответом с записанным SHA.`,
      },
    );
    await expect
      .poll(
        async () =>
          (await readTask()).timeline?.items.some(
            (i) =>
              !previous.has(i.id) &&
              i.kind === 'message' &&
              i.role === 'agent' &&
              i.text.includes(head),
          ),
        { timeout: 150_000 },
      )
      .toBe(true);
    expect(readFileSync(path, 'utf8').trim()).toBe(head);
    await expect
      .poll(
        async () => (await readChat()).timeline.turns.filter((t) => t.outcome === 'done').length,
        { timeout: 30_000 },
      )
      .toBe(2);
  } finally {
    try {
      const page = await app.firstWindow();
      if (taskSent)
        await page.evaluate(([id, task]) => window.skaro.invoke('task.interrupt', id, task), [
          project!,
          task,
        ] as const);
      if (chatId)
        await page.evaluate(([id, chat]) => window.skaro.invoke('chat.archive', id, chat, true), [
          project!,
          chatId,
        ] as const);
    } finally {
      try {
        if (restoreArchive) {
          const page = await app.firstWindow();
          await page.evaluate(
            ([id, task]) => window.skaro.invoke('tasks.archive', id, [task], true),
            [project!, task] as const,
          );
        }
      } finally {
        await app.evaluate(({ powerMonitor }) => powerMonitor.emit('shutdown'));
        await app.close();
        if (existsSync(path) && readFileSync(path, 'utf8').trim() === head) unlinkSync(path);
      }
    }
  }
});
