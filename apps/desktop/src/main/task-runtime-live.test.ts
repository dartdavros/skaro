import { AppDb } from '@skaro/core';
import { expect, it } from 'vitest';
import { updateTaskRuntime } from './task-runtime-state';

const profile = process.env['SKARO_RUNTIME_VERIFY_DB'];

it.skipIf(!profile)(
  'repeated idle settlement of a real Cat-pilot run needs no write or notification',
  () => {
    const db = AppDb.readOnly(profile!);
    try {
      const project = db.listProjects().find((entry) => entry.name.toLowerCase() === 'cat-pilot');
      expect(project).toBeDefined();
      db.shell.scopeTo(project!.id);
      const states = db.getTaskRuntime(project!.id);
      const run = db.listRuns(project!.id).find((entry) => !states.has(entry.taskId));
      expect(run, 'A real idle Cat-pilot task run is required').toBeDefined();
      let changes = 0;
      for (let i = 0; i < 1000; i++)
        if (updateTaskRuntime(db, project!.id, run!.taskId, 'idle', run!.id)) changes++;
      expect(changes).toBe(0);
      expect(db.getTaskRuntime(project!.id)).toEqual(states);
      console.log('Actual Cat-pilot runtime proof:', {
        projectId: project!.id,
        taskId: run!.taskId,
        calls: 1000,
        runtimeChanges: changes,
        writes: 0, // SQLite query_only would reject the first attempted write.
      });
    } finally {
      db.close();
    }
  },
);
