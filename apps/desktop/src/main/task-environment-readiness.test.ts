import { expect, it } from 'vitest';
import { COMPOSE_PROJECT, type DockerContainer } from '@skaro/core';
import { environmentReadinessProblems } from './task-environment-readiness';

// Pure interpretation of inspect metadata; no container, backend or API is substituted.
function service(
  name: string,
  state: DockerContainer['State'],
  project = 'task',
  oneoff = 'False',
): DockerContainer {
  return {
    Id: name,
    Name: name,
    State: state,
    Mounts: [],
    Config: {
      Labels: {
        [COMPOSE_PROJECT]: project,
        'com.docker.compose.service': name,
        'com.docker.compose.oneoff': oneoff,
      },
    },
  };
}

it('rejects a worker that exits after Compose wait even when the database is healthy', () => {
  expect(
    environmentReadinessProblems(
      [
        service('db', { Running: true, Health: { Status: 'healthy' } }),
        service('worker', { Running: false, ExitCode: 1 }),
      ],
      'task',
    ),
  ).toEqual(['worker: exited with code 1']);
});

it('ignores foreign containers and one-off checks, allowing completed migration services', () => {
  expect(
    environmentReadinessProblems(
      [
        service('db', { Running: true, Health: { Status: 'healthy' } }),
        service('migrate', { Running: false, ExitCode: 0 }),
        service('old-check', { Running: false, ExitCode: 1 }, 'task', 'True'),
        service('foreign', { Running: false, ExitCode: 1 }, 'other'),
      ],
      'task',
    ),
  ).toEqual([]);
});

it('rejects unhealthy, restarting or absent runtime services', () => {
  expect(
    environmentReadinessProblems(
      [service('db', { Running: true, Health: { Status: 'starting' } })],
      'task',
    ),
  ).toEqual(['db: health=starting']);
  expect(
    environmentReadinessProblems(
      [service('worker', { Running: true, Restarting: true, Status: 'restarting' })],
      'task',
    ),
  ).toEqual(['worker: restarting']);
  expect(environmentReadinessProblems([], 'task')).toEqual(['No running Compose services']);
});
