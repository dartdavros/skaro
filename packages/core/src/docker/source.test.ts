import { expect, it } from 'vitest';
import { sourceContainers } from './source.ts';
import type { DockerContainer } from './containers.ts';

const root = process.cwd();
const source = { project: 'main', services: ['postgres'] };
const container: DockerContainer = {
  Id: 'existing-main-database',
  Name: '/main-postgres-1',
  State: { Running: false },
  Mounts: [],
  Config: {
    Labels: {
      'com.docker.compose.project': 'main',
      'com.docker.compose.service': 'postgres',
      'com.docker.compose.project.working_dir': root,
    },
  },
};

it('selects only existing services from the declared main checkout', () => {
  expect(sourceContainers([container], root, source, 'skaro-main-t-1')).toEqual([container]);
  expect(() => sourceContainers([], root, source, 'skaro-main-t-1')).toThrow(
    'expected one existing container',
  );
  expect(() => sourceContainers([container], root + '/other', source, 'skaro-main-t-1')).toThrow(
    'does not belong',
  );
  expect(() => sourceContainers([container, container], root, source, 'skaro-main-t-1')).toThrow(
    'found 2',
  );
});

it('rejects another task or a partially missing source declaration before any start', () => {
  expect(() =>
    sourceContainers(
      [container],
      root,
      { project: 'skaro-main-t-1', services: ['postgres'] },
      'skaro-main-t-1',
    ),
  ).toThrow('not a task environment');
  expect(() =>
    sourceContainers(
      [container],
      root,
      { ...source, services: ['postgres', 'missing'] },
      'skaro-main-t-1',
    ),
  ).toThrow('main/missing');
});
