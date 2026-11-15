import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expand } from '@skaro/core';
import type { Services } from '../app-services';
import { projectSettings, saveProjectSettings } from '../project-settings';
import { sessionHandlers } from '../session-handlers';
import { coordinatorSourceAudit } from './coordinator-source-audit';
import { eventually } from './resource-workflow-observation';
import {
  isolationContainers,
  isolationFiles,
  isolationTask,
  isolationTool,
  waitIsolationTurn,
} from './environment-isolation-observation';

const exec = promisify(execFile);
const limits =
  'Это ограниченная read-only приёмка по разрешению владельца. Не меняй файлы, Git, критерии, данные, конфигурацию или продуктовый UI. Не вызывай submit_result, merge_task и не реализуй продуктовые задачи. После проверки ответь и остановись: владелец не разрешает дальнейшую реализацию.';

/** Real owner-authorized tasks, native agent, existing project Compose and normal resource guards. */
export async function verifyEnvironmentIsolation(
  s: Services,
  project: string,
  directory: string,
  proof: Record<string, unknown>,
) {
  const context = s.projects.get(project),
    engine = s.runs['engine'];
  const handlers = sessionHandlers(s),
    originalSettings = await projectSettings(s.projects, project);
  const artifacts = await context.load(),
    holder = artifacts.tasks.find((t) => t.id === 'T-006');
  assert(holder && holder.status === 'in_progress');
  assert(
    !s.db
      .listRuns(project)
      .some((r) => s.db.getSetting<{ enabled?: boolean }>(`execution.${r.id}`, {}).enabled),
  );
  const configPath = join(context.root, '.skaro/config.yaml'),
    holderPath = join(context.root, holder.path);
  const originalConfig = await readFile(configPath),
    originalHolder = await readFile(holderPath);
  await writeFile(join(directory, 'config-before.yaml'), originalConfig);
  await writeFile(join(directory, 'T-006-before.md'), originalHolder);
  const mainBefore = await coordinatorSourceAudit(context.root);
  const sharedBefore = await isolationContainers('cat-pilot-dev');
  assert.equal(sharedBefore.length, 1);
  const sharedId = sharedBefore[0]!.Id;
  const tasks: string[] = [];
  const setIsolation = async (isolation: 'worktree' | 'in-place') => {
    await saveProjectSettings(s.projects, project, { ...originalSettings, isolation }, 'ru');
    s.runs.projectChanged(project);
    assert.equal((await projectSettings(s.projects, project)).isolation, isolation);
  };
  const createAudit = async (mode: string) => {
    const task = await context.store.createTask({
      title: `Приёмка общего окружения и сохранности worktree: ${mode} ${randomUUID().slice(0, 8)}`,
      agent: 'codex',
      body: `## Цель\n\n${limits}\nПроверить режим ${mode}, реальное окружение Cat-pilot и сохранность ресурсов при смене настройки проекта.\n\n## Критерии приёмки\n\n- [ ] Прочитаны реальные исходники и проверено штатное окружение без изменений продукта.\n`,
    });
    tasks.push(task.id);
    context.invalidate();
    return task;
  };
  const send = (task: string, text: string) =>
    s.commands.accept('task.send', project, task, {
      commandId: randomUUID(),
      text: `${limits}\n${text}`,
    });
  let worktreeName: string | undefined;
  try {
    await context.store.updateTask(holder.id, { status: 'todo' });
    context.invalidate();
    if (!process.env.SKARO_ISOLATION_IN_PLACE_ONLY) {
      await setIsolation('worktree');
      const task = await createAudit('worktree');
      proof.worktreeTask = task.id;
      process.send?.({ phase: 'launching-real-worktree-task', task: task.id });
      const observe =
        "node -e \"const fs=require('node:fs'); const crypto=require('node:crypto'); let n=0; const timer=setInterval(()=>{console.log('WORKTREE_PRESERVATION_ACTIVE',process.cwd(),crypto.createHash('sha256').update(fs.readFileSync('index.html')).digest('hex')); if(++n===12)clearInterval(timer);},5000);\"";
      send(
        task.id,
        `Вызови start_environment и проверь реальный HTTP адрес. Затем выполни точно команду непрерывного чтения существующего index.html: ${observe}\nПосле её завершения ещё раз вызови start_environment в той же задаче, прочитай cwd и проверь тот же HTTP. Никаких других изменений. Закончи ответом WORKTREE_PRESERVED.`,
      );
      const active = await eventually(
        () => isolationTask(s, project, task.id),
        (o) =>
          o.commands.some(
            (c) => c.status === 'running' && c.command.includes('WORKTREE_PRESERVATION_ACTIVE'),
          ) || !!o.view.timeline?.turns.at(-1)?.outcome,
        'real agent actively reading its isolated checkout',
        300000,
      );
      assert(
        active.commands.some(
          (c) => c.status === 'running' && c.command.includes('WORKTREE_PRESERVATION_ACTIVE'),
        ),
        JSON.stringify({ errors: active.errors, tools: active.tools }),
      );
      const run = s.db.latestRun(project, task.id)!;
      assert(run.worktree && active.view.run?.live);
      const key = { projectId: project, taskId: task.id };
      const description = await engine.environments.describe(key);
      worktreeName = description.identity.name;
      const filesBefore = await isolationFiles(run.worktree);
      const containersBefore = await isolationContainers(worktreeName);
      assert(containersBefore.length && containersBefore.every((c) => c.State.Running));
      assert(active.tools.some((t) => t.name.endsWith('start_environment') && t.status === 'done'));
      const url = expand(description.config!.ready!, description.identity);
      const checkHttp = async () => {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        assert(response.ok);
        assert.equal(
          await response.text(),
          await readFile(join(run.worktree!, 'index.html'), 'utf8'),
        );
      };
      await checkHttp();
      proof.beforeSwitch = { run, files: filesBefore, containers: containersBefore, url };
      await writeFile(
        join(directory, 'before-switch.json'),
        JSON.stringify(proof.beforeSwitch, null, 2),
      );
      await setIsolation('in-place');
      const during = await isolationTask(s, project, task.id);
      assert(during.commands.some((c) => c.status === 'running'));
      assert.equal(during.view.settings.isolation, 'worktree');
      assert.equal(during.view.run?.worktree, run.worktree);
      assert.equal(s.db.latestRun(project, task.id)!.id, run.id);
      assert.deepEqual(await isolationFiles(run.worktree), filesBefore);
      assert.deepEqual(await isolationContainers(worktreeName), containersBefore);
      await checkHttp();
      proof.afterSwitch = {
        projectIsolation: (await projectSettings(s.projects, project)).isolation,
        taskIsolation: during.view.settings.isolation,
        runId: run.id,
        liveCommand: true,
        filesIdentical: true,
        containersIdentical: true,
      };
      process.send?.({
        phase: 'switched-while-command-running',
        task: task.id,
        ...(proof.afterSwitch as object),
      });
      const complete = await waitIsolationTurn(s, project, task.id);
      assert(
        complete.tools.filter((t) => t.name.endsWith('start_environment') && t.status === 'done')
          .length >= 2,
      );
      assert.deepEqual(await isolationFiles(run.worktree), filesBefore);
      await handlers['task.interrupt'](project, task.id);
      proof.worktreeAfterTurn = {
        files: await isolationFiles(run.worktree),
        containers: await isolationContainers(worktreeName),
        tools: complete.tools,
      };
    }
    if (process.env.SKARO_ISOLATION_WORKTREE_ONLY) return;
    await setIsolation('in-place');
    const inPlace = await createAudit('in-place');
    proof.inPlaceTask = inPlace.id;
    process.send?.({ phase: 'launching-real-in-place-task', task: inPlace.id });
    send(
      inPlace.id,
      `Проверь запуск в основной папке: используй общее окружение по инструкции in-place; не вызывай инструменты изолированных окружений. Отдельный checkout не нужен. Прочитай README.md и compose.yaml. Существующий общий контейнер cat-pilot-dev-web-1 (ID ${sharedId}) монтирует основную папку. Если он остановлен, разрешён только docker start ${sharedId}; не пересоздавай контейнер и не вызывай compose up. Проверь docker compose ps, HTTP http://localhost:18941 и равенство HTTP index.html реальному файлу основной папки; выполни node --check js/motion-controls.js. Укажи cwd и закончи ответом IN_PLACE_SHARED_VERIFIED.`,
    );
    const rootResult = await waitIsolationTurn(s, project, inPlace.id);
    const rootRun = s.db.latestRun(project, inPlace.id)!;
    assert.equal(rootRun.worktree, undefined);
    assert.equal(rootResult.view.settings.isolation, 'in-place');
    proof.inPlaceAgent = { run: rootRun, commands: rootResult.commands, tools: rootResult.tools };
    proof.inPlaceToolFallback = {
      start: await isolationTool(s, project, inPlace.id, 'start_environment'),
      configure: await isolationTool(s, project, inPlace.id, 'configure_environment'),
    };
    assert(
      !rootResult.tools.some((t) => t.output?.includes('The task has no checkout of its own')),
    );
    assert(rootResult.commands.some((c) => c.command.includes('node --check') && c.exitCode === 0));
    const sharedAfter = await isolationContainers('cat-pilot-dev');
    assert.equal(sharedAfter[0]?.Id, sharedId);
    assert.deepEqual(sharedAfter[0]?.Mounts, sharedBefore[0]!.Mounts);
    assert(sharedAfter[0]?.State.Running);
    const response = await fetch('http://localhost:18941', { signal: AbortSignal.timeout(10000) });
    assert(response.ok);
    assert.equal(await response.text(), await readFile(join(context.root, 'index.html'), 'utf8'));
    assert.deepEqual(await coordinatorSourceAudit(context.root), mainBefore);
    proof.inPlace = {
      run: rootRun,
      tools: rootResult.tools,
      commands: rootResult.commands,
      sharedBefore,
      sharedAfter,
      httpMatchesMain: true,
      mainSourcesUnchanged: true,
    };
    await handlers['task.interrupt'](project, inPlace.id);
  } finally {
    const cleanupErrors: string[] = [];
    for (const task of tasks) {
      try {
        await handlers['task.interrupt'](project, task);
        await context.store.updateTask(task, { status: 'todo', archived: true });
      } catch (error) {
        cleanupErrors.push(`${task}: ${String(error)}`);
      }
    }
    try {
      await writeFile(configPath, originalConfig);
    } finally {
      await writeFile(holderPath, originalHolder);
    }
    context.invalidate();
    assert.deepEqual(await readFile(configPath), originalConfig);
    assert.deepEqual(await readFile(holderPath), originalHolder);
    const shared = await isolationContainers('cat-pilot-dev');
    assert.equal(shared[0]?.Id, sharedId);
    if (!sharedBefore[0]!.State.Running && shared[0]?.State.Running)
      await exec('docker', ['stop', sharedId], { windowsHide: true, timeout: 30000 });
    proof.restored = {
      configExact: true,
      T006Exact: true,
      archivedAuditTasks: tasks,
      shared: await isolationContainers('cat-pilot-dev'),
      worktree: worktreeName ? await isolationContainers(worktreeName) : undefined,
      cleanupErrors,
    };
    assert.deepEqual(cleanupErrors, []);
  }
}
