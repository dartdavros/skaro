import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';
import { livePlanChat } from './plan-actions-live-support';
declare const window: Window & { skaro: SkaroApi };
const profile = process.env.SKARO_PLAN_ACTIONS_PROFILE;
const project = process.env.SKARO_VERIFICATION_PROJECT;
test.skip(!profile || !project, 'Requires explicit owner permission for genuine scoped Cat-pilot');

test('revises a real agent draft, creates exactly two tasks, deletes with rewiring and reverts through the existing card', async ({
  browserName: _,
}, info) => {
  test.setTimeout(600000);
  const app = await launchApp(profile!, { openSavedProject: false });
  let chat = '';
  let created: string[] = [];
  const prefix = `Skaro32-${Date.now()}`;
  const proof: Record<string, unknown> = { project, prefix };
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.bar').first().waitFor();
    const projects = await page.evaluate(() => window.skaro.invoke('projects.list'));
    expect(projects.map((p) => p.id)).toEqual([project]);
    const root = projects[0]!.path;
    const sourceState = () =>
      ['rev-parse', 'status'].map((command) =>
        execFileSync(
          'git',
          [
            '-C',
            root,
            ...(command === 'rev-parse'
              ? ['rev-parse', 'HEAD']
              : ['status', '--porcelain', '--', '.', ':!.skaro']),
          ],
          { encoding: 'utf8', windowsHide: true },
        ),
      );
    const before = sourceState();
    const originalTasks = await page.evaluate(
      (p) => window.skaro.invoke('tasks.list', p),
      project!,
    );
    const milestones = await page.evaluate(
      (p) => window.skaro.invoke('plan.milestones', p),
      project!,
    );
    expect(milestones.length).toBeGreaterThan(0);
    const milestone = milestones[0]!.id;
    const settings = await page.evaluate((p) => window.skaro.invoke('chats.defaults', p), project!);
    const task = (ref: string, title: string, depends_on: string[] = []) => ({
      ref,
      title,
      goal: 'Проверить подтверждаемое управление метаданными задач Skaro без изменения исходников.',
      criteria: ['Метаданные задачи проходят согласованную проверку управления планом.'],
      requirements: [],
      depends_on,
    });
    const initial = {
      key: prefix,
      title: `${prefix}: исходный план`,
      expected_total: 2,
      milestones: [
        {
          milestone,
          requirements: [],
          tasks: [task('first', `${prefix} A`), task('second', `${prefix} B`, ['first'])],
        },
      ],
    };
    const made = await page.evaluate(
      ({ p, settings, text }) => window.skaro.invoke('chat.create', p, settings, { text }),
      {
        p: project!,
        settings,
        text: `Владелец явно разрешил эту ограниченную проверку штатных инструментов Skaro: подготовить две проверочные задачи в Cat-pilot, затем исправить план, удалить и откатить их. Исходники, существующие задачи, этапы, C4 и окружения не изменять. Не запускать задачи, shell или computer use. Прочитай get_project_context и вызови prepare_plan с ${JSON.stringify(initial)}, затем propose_saved_plan и finish_plan. Обе задачи относятся только к разрешённой проверке метаданных. Не придумывай дополнительные задачи или спецификации. После показа одного полного плана заверши ход и жди.`,
      },
    );
    chat = made.id;
    const { proposals, offer } = livePlanChat(page, project!, chat);
    const old = await offer('plan');
    expect(old.proposal.type === 'plan' && old.proposal.tasks).toHaveLength(2);
    await page.evaluate(
      ({ p, c }) =>
        window.skaro.invoke('app.setSetting', 'ui.workspace', {
          view: 'project',
          sections: { [p]: 'chat' },
          openChats: { [p]: c },
          openTasks: {},
        }),
      { p: project!, c: chat },
    );
    await page.reload();
    const revision = {
      ...initial,
      title: `${prefix}: исправленный план`,
      reason: 'Владелец заменил вторую проверочную задачу и сохранил зависимость.',
      milestones: [
        {
          milestone,
          requirements: [],
          tasks: [task('first', `${prefix} A`), task('replacement', `${prefix} C`, ['first'])],
        },
      ],
    };
    await page.evaluate(({ p, c, text }) => window.skaro.invoke('chat.send', p, c, { text }), {
      p: project!,
      c: chat,
      text: `Исправь ещё не принятый план через revise_plan с ${JSON.stringify(revision)}. Задачи пока не создавать. Старую карточку должно заменить новое полное подтверждение. После инструмента заверши ход.`,
    });
    const revised = await offer('plan', old.id);
    expect((await proposals()).find((item) => item.id === old.id)!.state).toBe('superseded');
    expect(
      (await page.evaluate((p) => window.skaro.invoke('tasks.list', p), project!)).map((t) => t.id),
    ).toEqual(originalTasks.map((t) => t.id));
    const planCard = page.locator(`[id="proposal-${revised.id}"]`);
    await expect(planCard).toBeVisible();
    await page.screenshot({ path: info.outputPath('revised-draft.png') });
    await planCard.getByRole('button', { name: /Подтвердить план|Confirm plan/ }).click();
    await expect
      .poll(
        async () => {
          const tasks = await page.evaluate((p) => window.skaro.invoke('tasks.list', p), project!);
          created = tasks.filter((t) => t.title.startsWith(prefix)).map((t) => t.id);
          return created.length;
        },
        { timeout: 60000 },
      )
      .toBe(2);
    proof.draftRevisionVerified = true;
    await page.evaluate(({ p, c }) => window.skaro.invoke('chat.interrupt', p, c), {
      p: project!,
      c: chat,
    });
    const tasks = await page.evaluate((p) => window.skaro.invoke('tasks.list', p), project!);
    const a = tasks.find((t) => t.title === `${prefix} A`)!,
      c = tasks.find((t) => t.title === `${prefix} C`)!;
    expect(a).toBeDefined();
    expect(c).toBeDefined();
    expect(
      (
        await page.evaluate(({ p, id }) => window.skaro.invoke('task.open', p, id), {
          p: project!,
          id: c.id,
        })
      ).task.dependsOn.map((d) => d.id),
    ).toContain(a.id);
    await page.evaluate(({ p, c, text }) => window.skaro.invoke('chat.send', p, c, { text }), {
      p: project!,
      c: chat,
      text: `Предложи через update_task только изменение notes задачи ${a.id} на «${prefix}: проверка архивного ожидания». Не применяй изменение и не меняй другие поля. После инструмента заверши ход.`,
    });
    const update = await offer('task');
    await page.evaluate(({ p, ids }) => window.skaro.invoke('tasks.archive', p, ids, true), {
      p: project!,
      ids: [a.id],
    });
    expect(
      (await page.evaluate((p) => window.skaro.invoke('decisions.list', p), project!)).some(
        (d) => d.origin.id === chat,
      ),
    ).toBe(false);
    await page.reload();
    expect(
      (
        await page.evaluate(({ p, c }) => window.skaro.invoke('chat.open', p, c, { paged: true }), {
          p: project!,
          c: chat,
        })
      ).timeline.items.find((i) => i.id === update.id),
    ).toMatchObject({ state: 'superseded' });
    await page.screenshot({ path: info.outputPath('archived-task-no-expectation.png') });
    proof.archivedTaskAndChatProposalExcluded = true;
    await page.evaluate(({ p, ids }) => window.skaro.invoke('tasks.archive', p, ids, false), {
      p: project!,
      ids: [a.id],
    });
    await page.evaluate(
      ({ p, c, id }) => window.skaro.invoke('chat.proposal', p, c, id, { action: 'reject' }),
      { p: project!, c: chat, id: update.id },
    );
    await page.evaluate(({ p, c, text }) => window.skaro.invoke('chat.send', p, c, { text }), {
      p: project!,
      c: chat,
      text: `По прямому поручению владельца предложи удалить только ${a.id} через delete_tasks: key="${prefix}-delete", title="${prefix}: удалить A". В общем diff должна уйти зависимость ${c.id} от ${a.id}. Не применяй сам и не используй UI/shell. Заверши ход после инструмента.`,
    });
    const deletion = await offer('task_replan');
    expect(deletion.proposal).toMatchObject({
      taskIds: [a.id],
      tasks: [],
      rewired: [{ id: c.id, dependsOn: [] }],
    });
    const deleteCard = page.locator(`[id="proposal-${deletion.id}"]`);
    await expect(deleteCard).toBeVisible();
    await page.screenshot({ path: info.outputPath('delete-review.png') });
    await deleteCard.getByRole('button', { name: /^Применить$|^Apply$/ }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate((p) => window.skaro.invoke('tasks.list', p), project!)).some(
            (t) => t.id === a.id,
          ),
        { timeout: 60000 },
      )
      .toBe(false);
    expect(
      (
        await page.evaluate(({ p, id }) => window.skaro.invoke('task.open', p, id), {
          p: project!,
          id: c.id,
        })
      ).task.dependsOn,
    ).toEqual([]);
    proof.deletionAndRewireVerified = true;
    await deleteCard.getByRole('button', { name: /^Откатить$|^Revert$/ }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate((p) => window.skaro.invoke('tasks.list', p), project!)).some(
            (t) => t.id === a.id,
          ),
        { timeout: 60000 },
      )
      .toBe(true);
    expect(
      (
        await page.evaluate(({ p, id }) => window.skaro.invoke('task.open', p, id), {
          p: project!,
          id: c.id,
        })
      ).task.dependsOn.map((d) => d.id),
    ).toEqual([a.id]);
    await expect
      .poll(
        async () =>
          (await page.evaluate((p) => window.skaro.invoke('decisions.list', p), project!)).length,
        { timeout: 30000 },
      )
      .toBe(0);
    await expect(page.locator('[data-decision-button]')).toContainText(/·\s*0/, { timeout: 30000 });
    proof.finalExpectationsZero = true;
    await page.screenshot({ path: info.outputPath('delete-reverted.png') });
    proof.revertVerified = true;
    expect(sourceState()).toEqual(before);
    expect(errors).toEqual([]);
    proof.errors = errors;
    proof.productSourcesUnchanged = true;
  } finally {
    try {
      const page = await app.firstWindow();
      if (chat)
        await page.evaluate(({ p, c }) => window.skaro.invoke('chat.interrupt', p, c), {
          p: project!,
          c: chat,
        });
      const own = (
        await page.evaluate((p) => window.skaro.invoke('tasks.list', p), project!)
      ).filter((t) => t.title.startsWith(prefix));
      if (own.length)
        await page.evaluate(({ p, ids }) => window.skaro.invoke('tasks.delete', p, ids), {
          p: project!,
          ids: own.map((t) => t.id),
        });
      if (chat)
        await page.evaluate(({ p, c }) => window.skaro.invoke('chat.archive', p, c, true), {
          p: project!,
          c: chat,
        });
      proof.createdTasks = created;
      proof.verificationTasksRemoved = true;
    } finally {
      await app.evaluate(({ powerMonitor }) => powerMonitor.emit('shutdown'));
      await app.close();
    }
  }
  writeFileSync(info.outputPath('proof.json'), JSON.stringify({ ...proof, passed: true }, null, 2));
});
