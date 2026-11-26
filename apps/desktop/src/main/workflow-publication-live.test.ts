import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { publicationRequest } from '@skaro/mcp-server';
import { DbRuns } from '../../../../packages/core/src/db/runs';
import { PROJECT_DEFAULTS_KEY } from '../shared/ipc';
import { ProjectContext } from './projects';
import { inspectWorkflowPublication } from './workflow-publication';

/** Opt-in inspection of an explicitly selected real PR. The prepared command is never executed. */
const probe = process.env.SKARO_WORKFLOW_INSPECTION;
it.skipIf(!probe)(
  'binds the GitHub PR to the registered run and rejects a changed SHA',
  async () => {
    const { profile, project, task, publication } = JSON.parse(probe!);
    const request = publicationRequest(publication);
    const db = new DatabaseSync(join(profile, 'skaro.db'), { readOnly: true });
    let context: ProjectContext | undefined;
    try {
      const row = db.prepare('SELECT path FROM projects WHERE id=?').get(project);
      const run = new DbRuns(db, Date.now).listRuns(project, task)[0];
      if (!row || !run) throw new Error('The requested project or run is not registered');
      const defaults = db
        .prepare('SELECT value FROM settings WHERE key=?')
        .get(PROJECT_DEFAULTS_KEY);
      context = new ProjectContext(
        project,
        String(row.path),
        () => {},
        () => JSON.parse(String(defaults?.value ?? '{}')) ?? {},
      );
      const saved = await context.store.readTask(task);
      const result = await inspectWorkflowPublication(context, saved, run, request);
      expect(result.target.head).toBe(request.head);
      expect(result.target.blob).toMatch(/^[a-f0-9]{40}$/);
      console.log(result.state, result.target);
      const changed = request.head.slice(0, -1) + (request.head.endsWith('0') ? '1' : '0');
      await expect(
        inspectWorkflowPublication(context, saved, run, { ...request, head: changed }),
      ).rejects.toThrow('changed');
      expect(await context.store.readTask(task)).toEqual(saved);
    } finally {
      context?.close();
      db.close();
    }
  },
  120_000,
);
