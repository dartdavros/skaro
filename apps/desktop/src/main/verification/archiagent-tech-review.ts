import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { taskInputSnapshot } from '../task-preflight-inputs';
import { C4SemanticStore } from '../c4-semantic-store';
import { taskC4Protocol } from '../c4-protocol';
import { inspectSemanticC4Review } from '../c4-semantic-gate';
import { eventually } from './resource-workflow-observation';
import { approveC4TaskCommands } from './c4-task-permissions';
import { verifyC4CoordinationBrowser } from './c4-coordination-browser';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
/** Resume only the actual task's saved dirty rename; never rerun or recreate the source edit. */
export async function reviewArchiagentTechnical(s: Services, project: string, directory: string) {
  const started = JSON.parse(
    await readFile(join(directory, 'technical-task-started.json'), 'utf8'),
  );
  const context = s.projects.get(project),
    handlers = sessionHandlers(s),
    task = await context.store.readTask(String(started.task));
  assert.equal(task.title, 'Приёмка AG-1: технический результат и постоянный dev-контур Cat-pilot');
  const base = String(started.base),
    artifacts = { c4: started.originalModel };
  assert.equal(await context.git.head(), base);
  const script = await readFile(join(context.root, 'js/pause-controls.js'));
  assert.equal(sha(script), '079aa7a80f5e35b43a79c74d8d999ce68896ec188e4dc1e571081367997ac5bc');
  try {
    const run = s.db.latestRun(project, task.id)!;
    assert(run.worktree);
    assert.equal(taskC4Protocol(s.db, project, run.id), 'impact-v1');
    const dirty = async () => ({
      script: sha(await readFile(join(run.worktree!, 'js/motion-controls.js'))),
      html: sha(await readFile(join(run.worktree!, 'index.html'))),
      status: (await git(run.worktree!, ['status', '--porcelain'])).stdout,
    });
    const before = await dirty();
    assert.equal(before.script, sha(script));
    assert.equal(before.html, '09e3091bc5c5c22477a56460c84a3f282d26f64cd196458fc0e4d97c4eb2da1a');
    const inputs = await taskInputSnapshot(s.db, context, await context.load(), task.id);
    const head = await context.git.head('HEAD', run.worktree);
    await assert.rejects(
      s.runs.localCandidates.prepare(project, task.id, head, inputs.version),
      /Commit task changes/,
    );
    assert.deepEqual(await dirty(), before);
    const marker = `AG1_DIRTY_${randomUUID().slice(0, 8)}_CURRENT`;
    await context.store.updateTask(task.id, {
      body:
        task.body +
        `\n\nУточнение при ожидании ${marker}: действительны только текущие требования, реальное dirty переименование сохранить побайтно; до слияния требуется постоянный dev-контур.\n`,
    });
    context.invalidate();
    await assert.rejects(
      s.runs.localCandidates.prepare(project, task.id, head, inputs.version),
      /inputs changed/,
    );
    assert.deepEqual(await dirty(), before);
    const staged = (
      await git(run.worktree, ['diff', '--cached', '--name-only', '--no-renames'])
    ).stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    assert(
      staged.every((path) =>
        ['index.html', 'js/pause-controls.js', 'js/motion-controls.js'].includes(path),
      ),
      'Only authorized staged rename paths may be committed',
    );
    await git(run.worktree, ['add', '--', 'index.html', 'js/motion-controls.js']);
    await git(run.worktree, [
      'commit',
      '-m',
      ':art: refactor(js): rename pause controls to motion controls',
    ]);
    const committed = await context.git.head('HEAD', run.worktree);
    assert.notEqual(committed, base);
    const commandId = randomUUID(),
      instruction = 'Проверь текущие входы и независимое C4-ревью результата AG-1';
    s.commands.accept('task.send', project, task.id, {
      commandId,
      text: `${instruction}. Это разрешённое продолжение после Stop. Сначала resume_task с command_id="${commandId}" и instruction="${instruction}". Прочитай read_project_memory source="${task.path}" и get_c4_context. Контроллер сохранил dirty работу при изменении входов, commit ${committed} содержит только разрешённое переименование и одну ссылку. Текущий маркер требований ${marker}; назови его в ответе. Вызови review_c4 с фактическими данными, realized:[], затем закончи без polling. После автоматического независимого ревью только AG1_TECH_REVIEW_READY и конец хода. Не менять файлы, критерии или модель, не выполнять shell/commit/submit_result/merge_task/propose_c4 до отдельного AG1_LOCAL_VERIFIED от контроллера.`,
    });
    const store = new C4SemanticStore(s.db);
    const job = await eventually(
      async () => {
        await approveC4TaskCommands(s, project, task.id, 'motion');
        const j = store.current(run.id);
        if (j && ['failed', 'uncertain'].includes(j.state)) throw new Error(j.error ?? j.state);
        return j;
      },
      (j) => j?.state === 'verified' && j.delivered === true,
      'actual independent review of the committed rename',
      600000,
    );
    assert.equal(job?.verdict?.implementation, 'aligned');
    assert.equal(job.verdict.category, 'aligned');
    const review = await inspectSemanticC4Review(s.db, context, task.id, run.id);
    assert.deepEqual(review.realized, []);
    assert.equal((await s.c4.records(project, task.id)).length, 0);
    const browser = await verifyC4CoordinationBrowser(s, project, directory, task.id);
    assert(browser.identicalPixels);
    assert.equal(await context.git.head(), base);
    assert.deepEqual((await context.load()).c4, artifacts.c4);
    return {
      task: task.id,
      run,
      base,
      committed,
      job,
      review,
      browser,
      dirtyPreservedAcrossInputs: true,
      marker,
      oldInputs: inputs.version,
      configurationReferenceUpdated: true,
    };
  } finally {
    await handlers['task.interrupt'](project, task.id);
  }
}
