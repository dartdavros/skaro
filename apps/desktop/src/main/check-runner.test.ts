import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import { expect, it } from 'vitest';
import { AUTO_MERGE_KEY } from '../shared/ipc';
import { saveProjectSettings, toSettings } from './project-settings';
import { repo, db, projects, tasks, projectId, taskId, scope } from './task-run-test-support';

async function configure(run: string): Promise<void> {
  const context = projects.get(projectId);
  const { config } = await context.load();
  await context.store.writeConfig({ ...config, checks: [{ name: 'Acceptance', run }] });
  context.invalidate();
  db.setSetting(AUTO_MERGE_KEY, true);
}

it('runs checks on merged code and done metadata before publishing the base', async () => {
  await writeFile(join(repo, 'base-only.txt'), 'base');
  await git(repo, ['add', 'base-only.txt']);
  await git(repo, ['commit', '-qm', 'new base change']);
  await configure(
    `node -e "const fs=require('fs'); if(fs.readFileSync('feature.txt','utf8')!=='feature'||fs.readFileSync('base-only.txt','utf8')!=='base'||!fs.readFileSync('.skaro/tasks/T-001-retain-checkout.md','utf8').includes('status: done'))process.exit(1)"`,
  );
  const result = await tasks.mergeTask({}, scope());
  expect(result.isError).not.toBe(true);
  expect(db.listMerges(projectId, taskId)).toHaveLength(1);
  expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('feature');
});

it('blocks publication on failure, preserves task status, then reruns the changed command', async () => {
  await configure('node -e "console.error(\'check failed\'); process.exit(7)"');
  const head = (await git(repo, ['rev-parse', 'HEAD'])).stdout;
  const result = await tasks.mergeTask({}, scope());
  expect(result.isError).toBe(true);
  expect(result.text).toContain('Acceptance: exit 7');
  expect(result.text).toContain('check failed');
  expect((await git(repo, ['rev-parse', 'HEAD'])).stdout).toBe(head);
  expect(db.listMerges(projectId, taskId)).toEqual([]);
  expect((await projects.get(projectId).store.readTask(taskId)).status).toBe('todo');
  await configure('node -e "process.exit(0)"');
  expect((await tasks.mergeTask({}, scope())).isError).not.toBe(true);
}, 15_000);

it('rejects checks that modify tracked candidate code', async () => {
  await configure("node -e \"require('fs').writeFileSync('feature.txt','changed by check')\"");
  const head = (await git(repo, ['rev-parse', 'HEAD'])).stdout;
  const result = await tasks.mergeTask({}, scope());
  expect(result.isError).toBe(true);
  expect(result.text).toContain('Verification changed tracked files');
  expect((await git(repo, ['rev-parse', 'HEAD'])).stdout).toBe(head);
  expect(db.listMerges(projectId, taskId)).toEqual([]);
});

it('preserves checks when project settings are saved and blocks invalid config', async () => {
  await configure('node -e "process.exit(0)"');
  const context = projects.get(projectId);
  const before = (await context.load()).config;
  await saveProjectSettings(projects, projectId, toSettings(before), 'ru');
  expect((await context.load()).config.checks).toEqual(before.checks);
  await writeFile(join(repo, '.skaro', 'config.yaml'), 'checks: [{ name: Broken }]\n');
  context.invalidate();
  const result = await tasks.mergeTask({}, scope());
  expect(result.isError).toBe(true);
  expect(result.text).toContain('checks must be a list');
  expect(db.listMerges(projectId, taskId)).toEqual([]);
  await expect(saveProjectSettings(projects, projectId, toSettings(before), 'ru')).rejects.toThrow(
    'checks must be a list',
  );
  expect(await readFile(join(repo, '.skaro', 'config.yaml'), 'utf8')).toBe(
    'checks: [{ name: Broken }]\n',
  );
});

it('blocks malformed config roots instead of treating them as an empty checks list', async () => {
  db.setSetting(AUTO_MERGE_KEY, true);
  await writeFile(join(repo, '.skaro', 'config.yaml'), '- checks\n');
  projects.get(projectId).invalidate();
  const result = await tasks.mergeTask({}, scope());
  expect(result.isError).toBe(true);
  expect(result.text).toContain('Config must be a YAML mapping');
  expect(db.listMerges(projectId, taskId)).toEqual([]);
});
