import { expect, it } from 'vitest';
import { EnvironmentCommandFailed } from './environment-dispatch-error';
import { runEnvironmentCommand } from './environment-launch-command';

it('records effects of a dispatched shell before propagating its nonzero exit', async () => {
  const order: string[] = [];
  await expect(
    runEnvironmentCommand(
      'git rev-parse --verify refs/skaro/nonexistent-provenance-test',
      {
        cwd: process.cwd(),
        processStarted: () => {
          order.push('dispatched');
        },
      },
      async () => {
        order.push('observed');
      },
    ),
  ).rejects.toBeInstanceOf(EnvironmentCommandFailed);
  expect(order).toEqual(['dispatched', 'observed']);
});

it('keeps both errors when Docker cannot be inspected after a partial launch', async () => {
  await expect(
    runEnvironmentCommand(
      'git rev-parse --verify refs/skaro/nonexistent-provenance-test',
      { cwd: process.cwd() },
      async () => {
        throw new Error('inspection unavailable');
      },
    ),
  ).rejects.toThrow(/exit [1-9][\s\S]*inspection unavailable/);
});
