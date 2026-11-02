import assert from 'node:assert/strict';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { toolCatalog } from '@skaro/agent-runtime';
import type { Services } from '../app-services';
import { taskInstructions } from '../prompt-task';
import { criteriaRevision } from '../completion-store';
import { taskSections } from '../task-body';
import { planPayloadHash } from './model-plan-request';
import type { TaskStopReview } from './task-stop-review';
import { readLocalPacket } from './local-packet';
import { liveBudgetLedger } from '../credentials/live-budget-ledger';

const SOURCE_PATHS = [
  'index.html',
  'css/base.css',
  'css/scene.css',
  'css/cat.css',
  'css/plane.css',
  'js/controls.js',
  'checks/scene-animation.cjs',
  '.skaro/brief.md',
  '.skaro/architecture.md',
  '.skaro/docs/storyboard.md',
  '.skaro/specs/0001-animatsionnyy-rolik-kot-pilot.md',
  '.skaro/specs/0002-pauza-i-reduced-motion.md',
  '.skaro/tasks/T-006-animirovat-prohod-i-pryzhok-kota.md',
  '.skaro/tasks/T-008-knopka-pauzy-i-reduced-motion.md',
] as const;

export async function actualWorkflowSource(root: string, path: string) {
  const filename = resolve(root, path),
    canonical = await realpath(filename);
  const rel = relative(root, canonical),
    before = await lstat(filename);
  assert(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
  assert(
    canonical === filename &&
      before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink === 1 &&
      before.size < 100_000,
  );
  const text = await readFile(canonical, 'utf8'),
    after = await lstat(filename);
  for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'] as const)
    assert.equal(before[key], after[key]);
  return { path, text };
}

/** Concrete data/action proposal only. Preparing it cannot authorize or start either task. */
export async function prepareTaskWorkflowReview(
  services: Services,
  data: string,
  directory: string,
  original: TaskStopReview,
) {
  const context = services.projects.get(original.project.id);
  assert.equal(services.db.shell.projectScope, original.project.id);
  const metadataPath = join(directory, 'task-workflow-review-input.json');
  const metadata = (await readLocalPacket(data, metadataPath)) as {
    scope: { runId: string };
    instructions: string;
    browser: { name: string }[];
    skaro: { name: string }[];
  };
  const root = await realpath(context.root),
    artifacts = await context.load();
  const tasks = ['T-006', 'T-008'].map((id) => {
    const task = artifacts.tasks.find((item) => item.id === id);
    assert(task && task.status === 'todo');
    const revision = criteriaRevision(task);
    return {
      id,
      title: task.title,
      path: task.path,
      status: task.status,
      dependsOn: task.dependsOn,
      criteriaRevision: revision,
      criteria: taskSections(task.body).criteria.map((item, index) => ({
        id: `${original.project.id}:${id}:${revision}:${index + 1}`,
        text: item.text,
        met: item.done,
      })),
      instructions:
        id === 'T-006'
          ? metadata.instructions
          : taskInstructions({
              task,
              artifacts,
              root,
              cwd: root,
              locale: 'ru',
              managedEnvironment: false,
            }),
    };
  });
  const sources = [];
  for (const path of SOURCE_PATHS) sources.push(await actualWorkflowSource(root, path));
  const runtimeNames = [
    'read_file',
    'apply_patch',
    'run_check',
    'check_evidence',
    'inspect_acceptance',
    'plan_checks',
    'assess_checks',
    'diagnose_check',
    'ask_user',
    'update_plan',
  ];
  const skaroNames = [
    'get_c4_context',
    'review_c4',
    'submit_result',
    'merge_task',
    'report_task_blocker',
  ];
  const baseline = await liveBudgetLedger(join(data, 'verification/openrouter-ba4'));
  assert.deepEqual(baseline, { requests: 89, committedNanoUsd: 428414440 });
  const runner = resolve('apps/desktop/scripts/cat-pilot-flight-check.mjs');
  const measure = resolve('apps/desktop/scripts/cat-pilot-flight-measure.mjs');
  const controls = resolve('apps/desktop/scripts/cat-pilot-controls-check.mjs');
  const checkerRevisions = [];
  for (const path of [runner, measure, controls]) {
    const bytes = await readFile(path);
    checkerRevisions.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const ownerMessages = [
    'Проверка Stop/resume закончена. Теперь выполни настоящую T-006 по утверждённой раскадровке, без изменения рисунков и дизайна. Разрешены только перечисленные файлы и фиксированные проверки. Сначала прочитай контекст, спланируй проверки всех критериев и измерь исходный результат. После изменений повтори проверки, выполни C4 review и assess_checks. Сдавай через submit_result только при свежих положительных доказательствах всех критериев. Не запускай другие задачи.',
    'Продолжи текущую задачу после замечания: исправь только выявленное расхождение с раскадровкой, обнови проверки и доказательства перед повторной сдачей. Не обходи C4, вопросы, разрешения и ограничения бюджета.',
    'После успешной T-006 разрешена настоящая T-008 в штатном worktree с её существующими критериями. Сохрани утверждённый интерфейс. Проверь управление, reduced motion и результат в браузере; используй штатные capture/merge и только configured checks на слиянии.',
  ];
  const packet = {
    schema: 1,
    kind: 'cat-pilot-ba7-workflow-review',
    attemptId: randomUUID(),
    executionAuthorized: false,
    project: original.project,
    predecessorRunId: metadata.scope.runId,
    wireComposition: {
      route: original.wireComposition.route,
      tasks,
      sources,
      ownerMessages,
      tools: {
        runtime: toolCatalog().filter((item) => runtimeNames.includes(item.name)),
        browser: metadata.browser,
        skaro: metadata.skaro.filter((item) => skaroNames.includes(item.name)),
      },
      continuation: [
        'Only these source paths and their authorized changes, plus css/cat-motion.css, css/plane-motion.css and README.md',
        'Actual bounded outputs of fixed checks, browser geometry/console observations and task screenshots',
        'Actual tool proposals/results, criterion/C4/permission/question states and owner answers for T-006/T-008',
        'Own run/session/admission IDs, task history/handoff context and primary sequence/hash references',
        'No keys, authentication environment, other projects, arbitrary files or arbitrary commands',
      ],
    },
    actionProposal: {
      taskOrder: [
        'T-006 current in-place run',
        'T-008 new worktree only after normal dependency gates',
      ],
      sourceEdits: [
        'index.html (existing group order and animation stylesheet links only)',
        'css/cat-motion.css',
        'css/plane-motion.css',
        'css/base.css (existing pause/reduced-motion rules)',
        'css/scene.css (pause/reduced-motion only)',
        'js/controls.js (existing pause button)',
        'README.md (document actual file:// launch and storyboard path)',
      ],
      immutableSources: [
        'SVG geometry/drawings',
        'existing palette/components/layout',
        'brief/specs/storyboard',
        'check implementations',
      ],
      commands: [
        `node "${runner}" "${root}"`,
        `node "${runner}" "${root}" background`,
        `node "${runner}" "${root}" controls`,
        'For T-008 replace only the checkout argument with its actual persisted run.worktree; same Git common directory and registered Cat-pilot scope are required',
        'Only these commands may become configured integration checks; no arbitrary model shell',
      ],
      handoff:
        'Native builtin ↔ installed/auth-ready Codex/Claude; transactional handoff only, no managed model turn or external submission; resume through the approved OpenRouter route with fresh grants',
      environmentReview: {
        coverage: 'host-reviewed-assumptions, never measured dependency closure',
        concerns: [
          'Static file:// scene, no external services; unexpected network requests fail the trusted checker',
          'Measure host-selected Node/Chrome/checker files; installed transitive tooling remains an explicit assumption',
          'Review valid only for exact command/observation, measured dependency fingerprint and criterion revision',
        ],
      },
      prohibitions: [
        'other projects',
        'dependency bypass',
        'new product design',
        'arbitrary shell',
        'fabricated evidence',
        'automatic approval of owner decisions',
      ],
    },
    budgetProposal: {
      baseline,
      additionalRequests: 40,
      requestCeiling: 129,
      ceilingNanoUsd: 950_000_000,
      totalOwnerLimitUsd: 1,
      unknownHoldsRetained: true,
      proxy: 'http://127.0.0.1:10809',
      directFallback: false,
    },
    localGuards: {
      sourceRevisions: sources.map(({ path, text }) => ({
        path,
        sha256: createHash('sha256').update(text).digest('hex'),
      })),
      checkerRevisions,
      note: 'Wire snapshots are proposals. Live authorization must revalidate source/route/budget and bind exact executable hashes; no POST is enabled by preparation.',
    },
    pending: [
      'owner approval of this data/action scope and forty further OpenRouter requests',
      'final live-driver binding and positive task/worktree/merge acceptance',
    ],
  };
  const path = join(directory, 'task-workflow-review.json');
  await writeFile(path, JSON.stringify(packet, null, 2), { mode: 0o600, flag: 'wx' });
  return {
    path,
    sha256: planPayloadHash(packet),
    tasks: tasks.map(({ id, criteria }) => ({ id, criteria: criteria.length })),
    sourceFiles: sources.length,
    wireCompositionBytes: Buffer.byteLength(JSON.stringify(packet.wireComposition)),
    budgetProposal: packet.budgetProposal,
    modelRequests: 0,
    executionAuthorized: false,
  };
}
