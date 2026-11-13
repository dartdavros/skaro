import { expect, it } from 'vitest';
import type { DockerContainer } from '@skaro/core';
import { unavailablePorts } from './task-environment-ports';

it('honors a real Docker binding independently of host socket probe behavior', async () => {
  // Pure Docker/registry DTO contract. No listener, backend, daemon or replacement probe is created.
  const running: DockerContainer = {
    Id: 'foreign-container',
    Name: 'foreign-container',
    Mounts: [],
    Config: { Labels: { 'com.docker.compose.project': 'other-contour' } },
    State: { Running: true },
    NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '20002' }] } },
  };
  const record = {
    projectId: 'project',
    taskId: 'task',
    name: 'own-contour',
    ports: { UI_PORT: 20002 },
    created: false,
    usedAt: Date.now(),
  };
  expect(await unavailablePorts(record, [running])).toEqual(['UI_PORT']);
});
