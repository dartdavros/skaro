import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPOSE_PROJECT, COMPOSE_WORKDIR, type DockerContainer } from './containers.ts';
import { ownProjects } from './environment.ts';
import { containerTask } from './owner.ts';

const worktrees = join(process.cwd(), 'data', 'worktrees');
const task = { projectId: 'p1', taskId: 'T-026' };
const names = new Map([['skaro-shop-t-026', task]]);

function container(
  id: string,
  labels: Record<string, string>,
  binds: string[] = [],
): DockerContainer {
  return {
    Id: id,
    Name: `/${id}`,
    State: { Running: true },
    Config: { Labels: labels },
    Mounts: binds.map((Source) => ({ Type: 'bind', Source })),
  };
}

describe('containers of a task', () => {
  it('finds the task by the environment name and by its checkout, never the main copy', () => {
    const checkout = join(worktrees, 'p1', 'T-026');
    expect(
      containerTask(container('a', { [COMPOSE_PROJECT]: 'skaro-shop-t-026' }), worktrees, names),
    ).toEqual(task);
    // Started by the agent under a name of its own, from the task checkout.
    expect(
      containerTask(
        container('c', { [COMPOSE_PROJECT]: 't-026', [COMPOSE_WORKDIR]: checkout }),
        worktrees,
        names,
      ),
    ).toEqual(task);
    expect(
      containerTask(container('d', {}, [join(checkout, 'apps', 'backend')]), worktrees, names),
    ).toEqual(task);
    expect(
      containerTask(
        container('e', {
          [COMPOSE_PROJECT]: 'shop',
          [COMPOSE_WORKDIR]: join(process.cwd(), 'shop'),
        }),
        worktrees,
        names,
      ),
    ).toBe(undefined);
    // A neighbouring folder is another task's, however alike the names are.
    expect(containerTask(container('f', {}, [`${checkout}-other`]), worktrees, names)).not.toEqual(
      task,
    );
  });

  it('removes networks, volumes and images only of projects the task owns entirely', () => {
    const own = container('a', { [COMPOSE_PROJECT]: 'skaro-shop-t-026' });
    const stray = container('b', { [COMPOSE_PROJECT]: 'shop' });
    const main = container('c', { [COMPOSE_PROJECT]: 'shop' });
    expect(ownProjects('skaro-shop-t-026', [own, stray], [own, stray, main])).toEqual([
      'skaro-shop-t-026',
    ]);
  });
});
