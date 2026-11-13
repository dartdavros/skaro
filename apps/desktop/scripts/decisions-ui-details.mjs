/* global window, document, innerHeight, innerWidth, getComputedStyle */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export async function verifyForeignScope(invoke) {
  const decisions = await invoke('decisions.list', 'AC4-foreign-scope').then(
    () => 'accepted',
    String,
  );
  const activity = await invoke('activity.page', 'AC4-foreign-scope').then(
    () => 'accepted',
    String,
  );
  assert.match(decisions, /decision_project_scope_invalid/);
  assert.match(activity, /Activity project scope invalid/);
  return { decisionsRefused: true, journalRefused: true };
}

/** A genuine competing writer reservation, with no INSERT/UPDATE/COMMIT and bounded rollback. */
export async function verifySaveRetry({ page, directory, expect }) {
  const queue = page.getByRole('dialog', { name: 'Требуют ответа', exact: true });
  await queue.evaluate((node) =>
    Promise.all(node.getAnimations().map((animation) => animation.finished)),
  );
  const before = await queue.boundingBox();
  const lock = new DatabaseSync(join(process.env.APPDATA, 'Skaro', 'skaro.db'));
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      lock.exec('ROLLBACK');
      lock.close();
    }
  };
  lock.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  const timeout = setTimeout(release, 12000);
  try {
    await queue.getByRole('button', { name: 'Ответить', exact: true }).click();
    await expect(
      queue.getByText('Ответ не сохранён. Попробуйте ещё раз.', { exact: true }),
    ).toBeVisible({ timeout: 11000 });
    const after = await queue.boundingBox();
    assert(Math.abs(before.height - after.height) < 1);
    await page.screenshot({ animations: 'disabled', path: join(directory, 'save-error.png') });
    return { actualSqliteContention: true, rollbackOnly: true, height: after.height };
  } finally {
    clearTimeout(timeout);
    release();
  }
}

/** Inspect only the real project views and IPC; no responses or history are substituted. */
export async function verifyDecisionViews({
  page,
  electron,
  invoke,
  projectId,
  question,
  directory,
  expect,
}) {
  const counter = () => page.locator('[data-decision-button]');
  const queue = () => page.getByRole('dialog', { name: 'Требуют ответа', exact: true });
  await page.keyboard.press('Escape');
  const screens = [];
  for (let index = 0; index < 7; index++) {
    const item = page.locator('.project-nav button.item').nth(index);
    screens.push(await item.innerText());
    await item.click();
    await counter().click();
    await expect(queue().locator('[data-project-decision]')).toHaveCount(1);
    assert.equal(
      await queue().locator('[data-project-decision]').getAttribute('data-project-decision'),
      question.id,
    );
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Фоновая работа', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть решение', exact: true }).first().click();
  await expect(queue()).toBeVisible();
  assert.equal(
    await queue().locator('[data-project-decision]').getAttribute('data-project-decision'),
    question.id,
  );
  const bounds = await electron.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const previous = { bounds: win.getBounds(), maximized: win.isMaximized() };
    if (previous.maximized) win.unmaximize();
    win.setSize(960, 600);
    return previous;
  });
  try {
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(960);
    const geometry = await queue().evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const body = node.querySelector('[data-decision-list]');
      const footer = node.querySelector('.footer').getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        right: rect.right,
        bottom: rect.bottom,
        width: innerWidth,
        height: innerHeight,
        bodyOverflow: getComputedStyle(body).overflowY,
        footerBottom: footer.bottom,
        overflow: node.scrollWidth > node.clientWidth,
      };
    });
    assert(
      geometry.x >= 0 &&
        geometry.y >= 42 &&
        geometry.right <= geometry.width &&
        geometry.bottom <= geometry.height &&
        geometry.footerBottom <= geometry.height &&
        !geometry.overflow,
    );
    assert.equal(geometry.bodyOverflow, 'auto');
    await page.screenshot({ animations: 'disabled', path: join(directory, 'queue-960x600.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Фоновая работа', exact: true }).click();
    await page.getByRole('button', { name: 'Журнал проекта', exact: true }).click();
    const journal = page.locator('[data-project-journal]');
    await expect(journal).toBeVisible();
    const first = await invoke('activity.page', projectId);
    const rows = await journal.locator('.row').count();
    if (first.nextCursor) {
      const second = await invoke('activity.page', projectId, first.nextCursor);
      const ids = [...first.jobs, ...second.jobs].map((job) => job.id);
      assert.equal(new Set(ids).size, ids.length);
      await journal.getByRole('button', { name: 'Показать ещё', exact: true }).click();
      await expect.poll(() => journal.locator('.row').count()).toBeGreaterThanOrEqual(rows);
    }
    await page.screenshot({ animations: 'disabled', path: join(directory, 'journal-960x600.png') });
    await page.keyboard.press('Escape');
    await counter().click();
    await queue().getByRole('button', { name: 'Открыть задачу', exact: true }).click();
    const feed = page.locator('.task-conversation .fd-card.question');
    await expect(feed).toBeVisible();
    await page.locator('.task-conversation .scroller').evaluate((node) => {
      node.scrollTop = 0;
    });
    await expect(feed).toBeVisible();
    const pinned = await feed.evaluate(
      (node) => !!node.closest('.pending-actions') && !node.closest('.scroller'),
    );
    assert(pinned);
    await counter().click();
    return {
      screens,
      geometry,
      journalPaged: !!first.nextCursor,
      pinnedAfterHistoryScroll: pinned,
    };
  } finally {
    await electron.evaluate(({ BrowserWindow }, previous) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setBounds(previous.bounds);
      if (previous.maximized) win.maximize();
    }, bounds);
  }
}

export async function verifyFeedAnswerRace({
  page,
  invoke,
  projectId,
  taskId,
  previousId,
  directory,
  expect,
}) {
  const marker = `AC4_RACE_${randomUUID().slice(0, 8)}`;
  await invoke('task.send', projectId, taskId, {
    commandId: randomUUID(),
    text: `Для проверки общения нужно моё решение: объяснить порядок проверки или отложить проверку. Покажи карточку с одним вопросом и этими двумя вариантами и дождись ответа. Не реализуй T-010, не читай и не меняй файлы, не запускай команды. После ответа напиши только ${marker} и закончи. Другие инструменты, кроме вопроса, не вызывай.`,
  });
  const feed = page.locator('.task-conversation .fd-card.question');
  await expect(feed).toBeVisible({ timeout: 120000 });
  const entry = (await invoke('decisions.list', projectId)).find(
    (row) =>
      row.origin.id === taskId && row.kind === 'interaction' && row.interaction.kind === 'question',
  );
  assert(entry && entry.id !== previousId && entry.interaction.questions.length === 1);
  const waiting = await invoke('task.open', projectId, taskId, { paged: true });
  await feed.locator('.option').first().click();
  const result = await page.evaluate(
    async ({ projectId, entry }) => {
      document.querySelector('.task-conversation .fd-card.question .fd-card-foot button').click();
      return window.skaro
        .invoke('decisions.answer', projectId, entry.id, entry.revision, {
          kind: 'respond',
          answer: {
            kind: 'question',
            answers: Object.fromEntries(
              entry.interaction.questions.map((q) => [q.id, [q.options[0].label]]),
            ),
          },
        })
        .then(
          () => 'joined',
          (error) => String(error),
        );
    },
    { projectId, entry },
  );
  assert(result === 'joined' || /decision_stale/.test(result), result);
  await expect(feed).toHaveCount(0);
  await expect
    .poll(async () =>
      (await invoke('decisions.list', projectId)).some((row) => row.id === entry.id),
    )
    .toBe(false);
  await expect
    .poll(
      async () => (await invoke('task.open', projectId, taskId, { paged: true })).timeline.status,
      { timeout: 90000 },
    )
    .toBe('idle');
  const after = await invoke('task.open', projectId, taskId, { paged: true });
  assert.equal(after.timeline.turns.at(-1).id, waiting.timeline.turns.at(-1).id);
  assert.equal(after.timeline.turns.length, waiting.timeline.turns.length);
  const hash = createHash('sha256')
    .update(JSON.stringify([entry.id, entry.revision]))
    .digest('hex');
  const receipt = await invoke(
    'app.getSetting',
    `coordination.decision-reply.v1.${projectId}.${hash}`,
  );
  assert.equal(receipt.state, 'done');
  await page.screenshot({ animations: 'disabled', path: join(directory, 'feed-answer-race.png') });
  return { id: entry.id, concurrentResult: result, receiptState: receipt.state, oneTurn: true };
}
