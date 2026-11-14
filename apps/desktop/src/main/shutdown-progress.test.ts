import { expect, it } from 'vitest';
import {
  SHUTDOWN_STAGES,
  SHUTDOWN_SLOW_SECONDS,
  shutdownSeconds,
  shutdownTime,
  type ShutdownState,
} from '../shared/shutdown';
import { ShutdownProgress } from './shutdown-progress';
import { ShutdownPaint } from './shutdown-paint';
import { allowedDuringShutdown } from './shutdown-access';
import { runShutdownStage } from './shutdown-stage';

it('publishes one exit and advances completed stages without changing its start time', () => {
  const snapshots: ShutdownState[] = [];
  const progress = new ShutdownProgress((state) => snapshots.push(state));
  const first = progress.begin();
  expect(progress.begin()).toBe(first);
  expect(snapshots).toEqual([first]);
  for (const stage of SHUTDOWN_STAGES.slice(1)) {
    progress.complete(progress.state!.stage);
    progress.advance(stage);
  }
  expect(snapshots.map((state) => state.stage)).toEqual([
    'agents',
    'agents',
    'environments',
    'environments',
    'history',
    'history',
    'background',
  ]);
  expect(snapshots.map((state) => state.revision)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(snapshots.every((state) => state.startedAt === first.startedAt)).toBe(true);
  expect(first.completed).toEqual([]);
  expect(progress.state?.completed).toEqual(['agents', 'environments', 'history']);
  progress.advance('agents');
  expect(progress.state).toBe(snapshots.at(-1));
  progress.complete('agents');
  expect(snapshots).toHaveLength(7);
});

it('keeps the stage running until all parallel operations have finished', async () => {
  const progress = new ShutdownProgress(() => undefined);
  const finished: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  const operation = runShutdownStage(progress, 'agents', [
    [
      'parallel work',
      [
        async () => {
          await pending;
          finished.push('first');
        },
        () => {
          finished.push('second');
        },
      ],
    ],
    [
      'following work',
      [
        () => {
          finished.push('last');
        },
      ],
    ],
  ]);
  await Promise.resolve();
  expect(progress.state?.completed).toEqual([]);
  expect(finished).toEqual(['second']);
  release();
  await operation;
  expect(finished).toEqual(['second', 'first', 'last']);
  expect(progress.state?.completed).toEqual(['agents']);
});

it('holds teardown for the matching painted exit and ignores an earlier acknowledgement', async () => {
  const paint = new ShutdownPaint();
  let released = false;
  const pending = paint.wait(42).then(() => (released = true));
  paint.painted(41);
  await Promise.resolve();
  expect(released).toBe(false);
  paint.painted(42);
  await pending;
  expect(released).toBe(true);
});

it('does not mark a failed group as done and still runs the following cleanup', async () => {
  const progress = new ShutdownProgress(() => undefined);
  await runShutdownStage(progress, 'agents', [
    [
      'failing operation',
      [
        () => {
          throw new Error('Closing operation failed');
        },
      ],
    ],
  ]);
  expect(progress.state?.completed).toEqual([]);
  await runShutdownStage(progress, 'environments', [['following operation', [() => undefined]]]);
  expect(progress.state?.completed).toEqual(['environments']);
});

it('allows shutdown to proceed when the renderer never acknowledges its frame', async () => {
  await expect(new ShutdownPaint().wait(42, 10)).resolves.toBeUndefined();
});

it('keeps only presentation, startup metadata and window controls available during shutdown', () => {
  for (const method of [
    'app.shutdownState',
    'app.shutdownPainted',
    'app.shutdownNow',
    'window.minimize',
    'window.toggleMaximize',
    'window.isMaximized',
    'agents.catalog',
    'app.getLocale',
  ])
    expect(allowedDuringShutdown(method)).toBe(true);
  for (const method of [
    'chat.send',
    'task.send',
    'app.setSetting',
    'task.open',
    'projects.list',
    'window.close',
    'updates.apply',
  ])
    expect(allowedDuringShutdown(method)).toBe(false);
});

it('formats elapsed time and enables the agreed slow state after thirty seconds', () => {
  expect(shutdownSeconds(10_000, 9_000)).toBe(0);
  expect(shutdownTime(shutdownSeconds(10_000, 14_999))).toBe('00:04');
  expect(shutdownTime(shutdownSeconds(10_000, 71_000))).toBe('01:01');
  expect(shutdownSeconds(10_000, 39_999)).toBeLessThan(SHUTDOWN_SLOW_SECONDS);
  expect(shutdownSeconds(10_000, 40_000)).toBe(SHUTDOWN_SLOW_SECONDS);
});
