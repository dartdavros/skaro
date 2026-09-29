import { join } from 'node:path';
import { DEFAULT_CONFIG, type ProjectArtifacts, type Task } from '@skaro/core';
import { describe, expect, it } from 'vitest';
import { chatInstructions, taskInstructions } from './prompt';

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
});

describe('chat instructions', () => {
  const chat = (locale: string): string =>
    chatInstructions({ projectName: 'Магазин', root: '/work/project', artifacts, locale });

  it('names milestones «этапы» in Russian, as the interface does', () => {
    expect(chat('ru')).toContain('a milestone is «этап» (never «веха»)');
    expect(chat('en')).not.toContain('«этап»');
  });
});
