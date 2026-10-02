import { join } from 'node:path';
import { DEFAULT_CONFIG, type ProjectArtifacts, type Task } from '@skaro/core';
import { describe, expect, it } from 'vitest';
import { chatInstructions, importInstructions, taskInstructions } from './prompt';

const task: Task = {
  id: 'T-001',
  title: 'Каркас',
  status: 'todo',
  dependsOn: [],
  unblocked: false,
  archived: false,
  body: '## Цель\n\nСобрать каркас.\n\n## Критерии приёмки\n\n- [ ] Есть index.html\n- [x] Есть base.css\n',
  path: '.skaro/tasks/T-001-karkas.md',
};

const artifacts: ProjectArtifacts = {
  config: DEFAULT_CONFIG,
  brief: { kind: 'brief', title: 'Бриф', body: '', path: '.skaro/brief.md' },
  docs: [],
  adrs: [],
  specs: [],
  milestones: [],
  tasks: [task],
  problems: [],
};

describe('task instructions', () => {
  const text = taskInstructions({
    task,
    artifacts,
    root: '/work/project',
    cwd: '/data/worktrees/T-001',
    branch: 'skaro/T-001-karkas',
    locale: 'ru',
  });

  it('numbers the acceptance criteria for submit_result', () => {
    expect(text).toContain('1. Есть index.html\n2. Есть base.css');
    expect(text).toContain('submit_result');
  });

  it('points to the project context in the main folder, not the worktree', () => {
    expect(text).toContain(join('/work/project', '.skaro', 'brief.md'));
  });

  it('asks for commit messages in the repository convention', () => {
    expect(text).toMatch(/Conventional Commits in English/);
  });

  it('forbids calling the task done without a full report', () => {
    expect(text).toMatch(/done only when submit_result reports every criterion met/);
  });

  it('explains both merge modes and forbids reconfirming an already merged result', () => {
    expect(text).toContain('in automatic mode it merges immediately when unblocked');
    expect(text).toContain('in manual mode it shows a confirmation card');
    expect(text).toContain('do not call merge_task again to confirm it');
    expect(text).not.toContain('merges after the user confirms');
  });

  it('allows documented compatible services without repeated consent and protects other tasks', () => {
    expect(text).toContain('read-only inspection of running processes');
    expect(text).toContain('A responding localhost port alone does not establish ownership');
    expect(text).toContain('use it without asking for permission again');
    expect(text).toContain('verify against its own sources');
    expect(text).toContain(
      'Do not stop, restart, reconfigure or replace services owned by another task',
    );
    expect(text).toContain('Never replace missing APIs with mock responses');
  });
});

it('separates runtime approvals from owner decisions in tasks, chats and imports', () => {
  const common = { projectName: 'Магазин', root: '/work/project', artifacts, locale: 'ru' };
  const prompts = [
    taskInstructions({ ...common, task, cwd: '/data/worktrees/T-001' }),
    chatInstructions(common),
    importInstructions({ ...common, dir: '/data/imports/1', hasCode: true }),
  ];
  for (const text of prompts) {
    expect(text).toContain('current runtime permission policy');
    expect(text).toContain('Full access does not require additional permission');
    expect(text).toContain('Full access does not override explicit owner restrictions');
    expect(text).toContain('Existing user decisions remain valid');
    expect(text).toContain('structured question tool');
    expect(text).toContain('Do not finish a turn with a plain-text permission question');
    expect(text).toContain('Actually call the structured question tool');
    expect(text).toContain('submit_result does not create a question card');
    expect(text).toContain('without a successful tool invocation');
    expect(text).toContain('wait for its answer before completing dependent work');
  }
});

describe('chat instructions', () => {
  const chat = (locale: string): string =>
    chatInstructions({ projectName: 'Магазин', root: '/work/project', artifacts, locale });

  it('names milestones «этапы» in Russian, as the interface does', () => {
    expect(chat('ru')).toContain('a milestone is «этап» (never «веха»)');
    expect(chat('en')).not.toContain('«этап»');
  });
});
