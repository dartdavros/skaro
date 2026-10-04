import { AppDb, ArtifactStore } from '@skaro/core';
import { join } from 'node:path';
import { makeRepo } from './agent-task-support';

/** Authorized file/Git fixtures; the native project service loads all plan data. */
export async function planProject(userData: string, empty = false) {
  const store = new ArtifactStore(makeRepo(userData));
  if (empty) {
    await store.deleteTask('T-001');
    await store.deleteTask('T-002');
  } else {
    for (const title of ['First milestone', 'Second milestone', 'Empty milestone']) {
      await store.createMilestone({
        title,
        body: '## Цель\n\nGoal.\n\n## Критерий готовности\n\nDone.\n',
      });
    }
    await store.updateTask('T-001', { milestone: 'M01', status: 'done', order: 1 });
    await store.updateTask('T-002', { milestone: 'M02', order: 1 });
    await store.createTask({ title: 'Loose task' });
  }
  const db = AppDb.open(join(userData, 'skaro.db'));
  const project = db.addProject({ name: 'Plan verification', path: store.root });
  db.setOpenTabs([project.id], project.id);
  db.setSetting('ui.locale', 'ru');
  db.close();
  return store;
}
