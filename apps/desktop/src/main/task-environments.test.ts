import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TaskEnvironments } from './task-environments';
import { db, dir, projectId, projects, repo, taskId, taskRunDeps } from './task-run-test-support';

/** Commands that record their run and the variables they got, instead of starting services. */
const record = (step: string) =>
  `node -e "require('fs').appendFileSync('steps.log', '${step} ' + process.env.COMPOSE_PROJECT_NAME + ' ' + process.env.API_PORT + '\\n')"`;

async function environments(config: string, hasData: () => boolean) {
  await writeFile(join(repo, '.skaro', 'config.yaml'), config);
  projects.get(projectId).invalidate();
  const checkout = join(dir, 'worktrees', projectId, taskId);
  await mkdir(checkout, { recursive: true });
  const removed: string[] = [];
  const service = new TaskEnvironments({
    db,
    dataDir: dir,
    projects,
    busy: () => [],
    limit: () => 3,
    finished: async () => false,
    docker: {
      ...taskRunDeps().docker!,
      hasData: async () => hasData(),
      remove: async (_containers, projects) => {
        removed.push(...projects);
        return [];
      },
    },
  });
  const steps = async () =>
    (await readFile(join(checkout, 'steps.log'), 'utf8')).trim().split('\n');
  return { service, steps, removed };
}

const described =
  'environment:\n' +
  '  ports: [API_PORT]\n' +
  `  create: ${JSON.stringify(record('create'))}\n` +
  `  start: ${JSON.stringify(record('start'))}\n` +
  '  urls:\n    api: "http://localhost:{API_PORT}"\n';

describe('task environment', () => {
  it('copies the data once, starts on every request and answers with the addresses', async () => {
    let data = false;
    const { service, steps } = await environments(described, () => data);
    const key = { projectId, taskId };
    const name = `skaro-runtime-safety-${taskId.toLowerCase()}`;
    expect(await service.start(key)).toEqual({ name, urls: { api: 'http://localhost:20000' } });
    data = true;
    await service.start(key);
    expect(await steps()).toEqual([
      `create ${name} 20000`,
      `start ${name} 20000`,
      `start ${name} 20000`,
    ]);
    // The agent's shell gets the same project name and port as the commands.
    expect(await service.sessionEnv(key)).toMatchObject({
      COMPOSE_PROJECT_NAME: name,
      API_PORT: '20000',
    });
  });

  it('copies the data again when the copy was removed by hand, never starting on empty data', async () => {
    const { service, steps, removed } = await environments(described, () => false);
    const key = { projectId, taskId };
    await service.start(key);
    await service.start(key);
    expect((await steps()).filter((step) => step.startsWith('create'))).toHaveLength(2);
    expect(removed).toHaveLength(2);
  });

  it('refuses to start what the project does not describe', async () => {
    const { service } = await environments('default_agent: codex\n', () => false);
    await expect(service.start({ projectId, taskId })).rejects.toThrow('describes no task');
  });
});
