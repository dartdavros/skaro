import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { GitService, git } from '@skaro/core';
import { prepareTaskWorktree } from './task-worktree';

const data = process.env.SKARO_CLEANUP_VERIFY_DATA;
const taskId = process.env.SKARO_CLEANUP_VERIFY_TASK;

// Explicit opt-in: an existing clean, completed Cat-pilot checkout, never a generated fixture.
it.skipIf(!data || !taskId)(
  'removes and recreates the real checkout without losing commits or history',
  async () => {
    const db = new DatabaseSync(join(data!, 'skaro.db'), { readOnly: true });
    const catalog = new DatabaseSync(join(data!, 'tasks.db'), { readOnly: true });
    try {
      const projects = db
        .prepare('SELECT id,path FROM projects WHERE name=? COLLATE NOCASE')
        .all('Cat-pilot') as { id: string; path: string }[];
      expect(projects).toHaveLength(1);
      const project = projects[0]!;
      const task = () =>
        catalog
          .prepare('SELECT * FROM task_catalog WHERE project=? AND id=?')
          .get(project.id, taskId!);
      const beforeTask = task();
      expect(beforeTask?.status).toBe('done');
      const history = () =>
        db
          .prepare('SELECT * FROM runs WHERE project_id=? AND task_id=? ORDER BY started_at')
          .all(project.id, taskId!);
      const beforeHistory = history();
      expect(beforeHistory.length).toBeGreaterThan(0);
      const path = resolve(data!, 'worktrees', project.id, taskId!);
      const latest = beforeHistory.at(-1)!;
      expect(resolve(String(latest.worktree))).toBe(path);
      const branch = String(latest.branch);
      const hashLogs = async () =>
        Promise.all(
          beforeHistory.map(async (run) =>
            createHash('sha256')
              .update(await readFile(join(data!, String(run.log_path))))
              .digest('hex'),
          ),
        );
      const logs = await hashLogs();
      const service = new GitService(project.path);
      expect(await service.currentBranch(path)).toBe(branch);
      const head = (await git(path, ['rev-parse', 'HEAD'])).stdout.trim();
      await service.assertRemovableWorktree(path);
      await expect(
        service.removeWorktree(path, { preserve: { branch, head: 'invalid' } }),
      ).rejects.toThrow('preserved branch changed');
      expect(existsSync(path)).toBe(true);
      try {
        await service.removeWorktree(path, { preserve: { branch, head } });
        expect(existsSync(path)).toBe(false);
        expect((await git(project.path, ['rev-parse', `refs/heads/${branch}`])).stdout.trim()).toBe(
          head,
        );
        expect(task()).toEqual(beforeTask);
        expect(history()).toEqual(beforeHistory);
        expect(await hashLogs()).toEqual(logs);
      } finally {
        if (!existsSync(path))
          await prepareTaskWorktree({
            git: service,
            dataDir: data!,
            projectId: project.id,
            taskId: taskId!,
            branch,
            base: head,
          });
      }
      expect((await git(path, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(head);
      expect((await git(path, ['status', '--porcelain', '--ignored=matching'])).stdout).toBe('');
    } finally {
      catalog.close();
      db.close();
    }
  },
  60_000,
);
