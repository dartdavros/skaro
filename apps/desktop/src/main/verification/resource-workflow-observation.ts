import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { git } from '@skaro/core';
import type { Services } from '../app-services';
import type { ManagedDockerClient } from '../managed-docker-client';
import { observedDockerEnvironment } from '../managed-docker-observation';

export async function eventually<T>(
  read: () => T | Promise<T>,
  accepts: (value: T) => boolean,
  label: string,
  timeout = 120000,
): Promise<T> {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await read();
    if (accepts(value)) return value;
    await delay(250);
  }
  throw new Error(`Timed out: ${label}`);
}
export async function resourceInventory(root: string, client?: ManagedDockerClient) {
  const run = promisify(execFile);
  const options = {
    windowsHide: true,
    timeout: 20000,
    ...(client ? { env: observedDockerEnvironment(client) } : {}),
  };
  const docker = client?.docker ?? 'docker';
  const [worktrees, containers, volumes, images, networks] = await Promise.all([
    git(root, ['worktree', 'list', '--porcelain']),
    run(docker, ['ps', '-aq', '--no-trunc'], options),
    run(docker, ['volume', 'ls', '-q'], options),
    run(docker, ['images', '-q', '--no-trunc'], options),
    run(docker, ['network', 'ls', '-q', '--no-trunc'], options),
  ]);
  return {
    worktrees: worktrees.stdout,
    containers: containers.stdout.trim().split(/\r?\n/).sort(),
    volumes: volumes.stdout.trim().split(/\r?\n/).sort(),
    images: images.stdout.trim().split(/\r?\n/).sort(),
    networks: networks.stdout.trim().split(/\r?\n/).filter(Boolean).sort(),
  };
}
export async function finishedTask(
  services: Services,
  project: string,
  task: string,
  previous = 0,
) {
  return eventually(
    () => services.runs.open(project, task),
    (view) =>
      !!view.timeline &&
      view.timeline.turns.length > previous &&
      !!view.timeline.turns.at(-1)?.outcome &&
      view.timeline.status === 'idle',
    'actual task turn completion',
    240000,
  );
}
export function requireReleased(services: Services, project: string, owner: string) {
  assert(!services.resources.holdings(project, owner).length, `Still holds capacity: ${owner}`);
}
