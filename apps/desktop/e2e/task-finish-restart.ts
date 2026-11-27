import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { launchApp } from './launch';
import type { TaskView, SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };

export async function openCompletionTask(page: Page, project: string, task: string) {
  await page.evaluate(
    async ({ project, task }) => {
      await window.skaro.invoke('tabs.set', { projects: [project], active: project });
      await window.skaro.invoke('app.setSetting', 'ui.workspace', {
        view: 'project',
        sections: { [project]: 'tasks' },
        openTasks: { [project]: task },
        openChats: {},
      });
    },
    { project, task },
  );
  await page.reload();
}

export async function finishAfterRestart(
  app: ElectronApplication,
  page: Page,
  profile: string,
  project: string,
  task: string,
  opened: (next: ElectronApplication) => void,
) {
  const view = (windowPage: Page) =>
    windowPage.evaluate(({ project, task }) => window.skaro.invoke('task.open', project, task), {
      project,
      task,
    });
  const decision = (taskView: TaskView) =>
    taskView.timeline?.interactions.find(
      (item) =>
        item.kind === 'question' &&
        item.id.startsWith('skaro-wait-') &&
        item.questions.some((q) => q.options.some((o) => o.label === 'Доделать')),
    )?.id;
  await expect.poll(async () => decision(await view(page)), { timeout: 140_000 }).toBeTruthy();
  const original = decision(await view(page));
  await app.close();
  const next = await launchApp(profile, { openSavedProject: false });
  opened(next);
  const restored = await next.firstWindow();
  expect(decision(await view(restored))).toBe(original);
  await openCompletionTask(restored, project, task);
  const option = restored.getByRole('radio', { name: /Доделать/ });
  const card = restored.locator('.fd-card.question').filter({ has: option });
  await option.click();
  await card.locator('.fd-card-foot button').click();
  await expect.poll(async () => decision(await view(restored))).toBeUndefined();
  return restored;
}

export function assertMergedDocument(view: TaskView, root: string, file: string, before: string) {
  const merged = view.timeline?.items.find(
    (item) => item.kind === 'notice' && item.code === 'merged',
  );
  if (merged?.kind !== 'notice' || !merged.native.ref)
    throw new Error('Missing persisted merge receipt');
  const commit = merged.native.ref;
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['merge-base', '--is-ancestor', before, commit]);
  git(['merge-base', '--is-ancestor', commit, 'HEAD']);
  expect(git(['diff', '--name-only', before, commit, '--', '.', ':(exclude).skaro'])).toBe(file);
  expect(git(['show', `${commit}:${file}`])).toContain('index.html');
  expect(
    view.timeline?.items.filter((i) => i.kind === 'tool' && /(?:c4|project_incident)/.test(i.name)),
  ).toEqual([]);
}
