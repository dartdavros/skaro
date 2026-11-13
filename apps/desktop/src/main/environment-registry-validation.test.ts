import { expect, it } from 'vitest';
import { activeEnvironment, retiredEnvironment } from './environment-registry-validation';

it('rejects malformed ownership, allocation proof and source declarations before any registry mutation', () => {
  const retired = { projectId: 'project', taskId: 'task', name: 'compose' };
  expect(retiredEnvironment(retired)).toBe(true);
  expect(retiredEnvironment({ ...retired, taskId: null })).toBe(false);
  expect(retiredEnvironment({ ...retired, allocatedAt: -1 })).toBe(false);
  expect(
    retiredEnvironment({ ...retired, source: { project: 'main', services: 'postgres' } }),
  ).toBe(false);
  const active = { ...retired, ports: { PORT: 20000 }, created: false, usedAt: 1 };
  expect(activeEnvironment(active)).toBe(true);
  expect(activeEnvironment({ ...active, ports: ['20000'] })).toBe(false);
  expect(activeEnvironment({ ...active, ports: { PORT: 70000 } })).toBe(false);
  expect(activeEnvironment({ ...active, previousPorts: { PORT: 'invalid' } })).toBe(false);
});
