import { expect, it } from 'vitest';
import { integrationUsesEnvironment } from './task-environment-consumers';

it('releases the publication slot as an environment consumer only after verifying and retiring both writers', () => {
  expect(integrationUsesEnvironment({ state: 'verifying' })).toBe(true);
  expect(integrationUsesEnvironment({ state: 'ready', worker: 'resolver' })).toBe(true);
  expect(integrationUsesEnvironment({ state: 'ready', executor: 'verification' })).toBe(true);
  expect(integrationUsesEnvironment({ state: 'ready' })).toBe(false);
});
