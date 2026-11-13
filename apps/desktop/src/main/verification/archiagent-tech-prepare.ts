import { reviewArchiagentTechnical } from './archiagent-tech-review';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { eventually } from './resource-workflow-observation';
import { AG1_MOTION_COMMAND, approveC4TaskCommands } from './c4-task-permissions';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export async function prepareArchiagentTechnical(s: Services, project: string, directory: string) {
  const context = s.projects.get(project),
    handlers = sessionHandlers(s),
    artifacts = await context.load();
  assert.equal(artifacts.c4?.revision, 4);
  assert.equal(artifacts.c4.questions.length, 9);
  const title = 'Приёмка AG-1: технический результат и постоянный dev-контур Cat-pilot';
  assert(!artifacts.tasks.some((t) => t.title === title), 'Never duplicate a real acceptance task');
  const base = await context.git.head();
  assert.equal(base, '372e979b2908a6b8b1c8ce949dc8c02fbe83d9cb');
  const script = await readFile(join(context.root, 'js/pause-controls.js'));
  const html = await readFile(join(context.root, 'index.html'), 'utf8');
  assert.equal(sha(script), '079aa7a80f5e35b43a79c74d8d999ce68896ec188e4dc1e571081367997ac5bc');
  assert.equal(sha(html), 'c2d2532e44b8aee69c5e2f6e03fa015471a03006c58a2885451269f951d0056f');
  const configPath = join(context.root, '.skaro/config.yaml'),
    config = await readFile(configPath, 'utf8');
  assert.equal(config.split('node --check js/pause-controls.js').length, 2);
  // Maintain the existing real check for the renamed file; all other configuration bytes stay intact.
  await writeFile(
    configPath,
    config.replace('node --check js/pause-controls.js', 'node --check js/motion-controls.js'),
  );
  context.invalidate();
  const task = await context.store.createTask({
    title,
    agent: 'codex',
    body: '## Цель\n\nРеальная совместная приёмка AG-1 по прямому разрешению владельца. Только js/pause-controls.js → js/motion-controls.js и единственная ссылка index.html; байты JS, CSS, поведение и прочие исходники сохранить. Проверить штатный постоянный dev-контур до Git-приёмки. Не реализовывать T-008 и не менять её критерии или архитектурные вопросы.\n\n## Критерии приёмки\n\n- [ ] Выполнены только точное переименование JS и одна ссылка index.html, байты и поведение сохранены.\n- [ ] Настоящая синтаксическая проверка и независимое C4-ревью подтверждают техническое изменение без нового material-вопроса; current/planned и 9 вопросов сохранены.\n- [ ] Контроллер проверил immutable local candidate в зарегистрированном cat-pilot-dev до Git-приёмки и получил точный результат для штатной сдачи.\n',
  });
  context.invalidate();
  await writeFile(
    join(directory, 'technical-task-started.json'),
    JSON.stringify(
      { task: task.id, base, configBefore: config, originalModel: artifacts.c4 },
      null,
      2,
    ),
  );
  await handlers['task.setSettings'](project, task.id, {
    agent: 'codex',
    permissionMode: 'ask',
    planFirst: false,
    isolation: 'worktree',
  });
  try {
    const prompt = `Владелец разрешил реальную приёмку AG-1, только js/pause-controls.js → js/motion-controls.js и одну ссылку index.html. Сейчас выполни только rename и проверку, затем закончи ход фразой AG1_RENAME_READY. Четыре отдельные точные shell-команды без цепочек/pipe: git mv -- js/pause-controls.js js/motion-controls.js ; ${AG1_MOTION_COMMAND} ; git diff --find-renames HEAD ; node --check js/motion-controls.js . Допускаются Get-Content -Raw -LiteralPath index.html, js/pause-controls.js, js/motion-controls.js. Другие файлы, JS-логику, CSS, критерии, модель, planned/current и вопросы не менять. Сейчас не вызывать review_c4, propose_c4, submit_result, merge_task и не делать commit: контроллер проверяет сохранность настоящего dirty результата и локальный контур до сдачи.`;
    await handlers['tasks.run'](project, [task.id], prompt);
    await eventually(
      async () => {
        await approveC4TaskCommands(s, project, task.id, 'motion');
        return s.runs.open(project, task.id);
      },
      (v) => v.timeline?.turns.at(-1)?.outcome === 'done' && v.timeline.status === 'idle',
      'real native authorized rename',
      360000,
    );
    await handlers['task.interrupt'](project, task.id);
    return await reviewArchiagentTechnical(s, project, directory);
  } finally {
    await handlers['task.interrupt'](project, task.id);
  }
}
