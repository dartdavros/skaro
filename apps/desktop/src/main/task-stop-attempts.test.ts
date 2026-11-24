import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { AppDb } from '@skaro/core';
import { EventChannel } from '@skaro/timeline';
import { expect, it } from 'vitest';
import { TaskRunProcesses } from './task-run-processes';
import { processBirth } from './process-identity';
import { TaskStopAttempts } from './task-stop-attempts';
import { readSessionEvents } from './task-session-cancellation';
import { drainRetiredEvents } from './task-session-detach';

it('releases the caller at the deadline and an explicit Stop retires the same owned process', async () => {
  const db = AppDb.open(':memory:');
  const processes = new TaskRunProcesses(db);
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  const exited = once(child, 'exit');
  const key = 'deadline-verification';
  let starts = 0;
  let terminations = 0;
  let termination: Promise<void> | undefined;
  let recovered = 0;
  try {
    await processes.startedAsync(key, child.pid!);
    const birth = await processBirth(child.pid!);
    const stops = new TaskStopAttempts(100);
    const stop = (owner: boolean) =>
      stops.run(
        key,
        async () => {
          starts++;
          await exited;
        },
        async () => {
          terminations++;
          termination = processes.stop(key);
          await termination;
        },
        owner,
        () => {
          recovered++;
        },
      );
    await expect(stop(true)).rejects.toThrow('still unconfirmed');
    await expect(stop(false)).rejects.toThrow('still unconfirmed');
    expect(stops.has(key)).toBe(true);
    expect(await processBirth(child.pid!)).toBe(birth);
    expect(terminations).toBe(0);
    // The OS identity query can outlive another call's short observation deadline.
    await Promise.allSettled([stop(true), stop(true)]);
    expect(termination).toBeDefined();
    await termination;
    await expect.poll(() => stops.has(key), { timeout: 20000 }).toBe(false);
    expect([starts, terminations, recovered]).toEqual([1, 1, 1]);
    expect(await processBirth(child.pid!)).not.toBe(birth);
    expect(db.getSetting(`run.${key}.processes`, null)).toEqual([]);
  } finally {
    child.stdin.end();
    await processes.stop(key);
    await exited;
    db.close();
  }
}, 30000);

it('can retire a reader waiting on a real event channel without consuming later events', async () => {
  const events = new EventChannel<number>();
  const reader = new AbortController();
  const observed: number[] = [];
  const drain = readSessionEvents(events, reader.signal, (value) => observed.push(value));
  events.push(1);
  await expect.poll(() => observed).toEqual([1]);
  await drainRetiredEvents({ pumping: drain, eventReader: reader });
  expect(reader.signal.aborted).toBe(true);
  await drain;
  events.push(2);
  events.close();
  expect(observed).toEqual([1]);
});

it('verifies a second owned process registered during teardown before clearing the ledger', async () => {
  const db = AppDb.open(':memory:');
  const processes = new TaskRunProcesses(db);
  const key = 'overlapping-process-admission';
  const children = Array.from({ length: 2 }, () =>
    spawn(process.execPath, ['-e', 'process.stdin.resume()'], {
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'ignore', 'ignore'],
    }),
  );
  const exits = children.map((child) => once(child, 'exit'));
  try {
    const [first, next] = children;
    await processes.startedAsync(key, first!.pid!);
    const birth = await processBirth(next!.pid!);
    expect(birth).toBeTruthy();
    const stopping = processes.stop(key);
    processes.started(key, next!.pid!, false, { birth: birth!, platform: process.platform });
    await stopping;
    expect(await processBirth(next!.pid!)).not.toBe(birth);
    expect(db.getSetting(`run.${key}.processes`, null)).toEqual([]);
  } finally {
    for (const child of children) child.stdin.end();
    await processes.stop(key);
    await Promise.all(exits);
    db.close();
  }
}, 30000);
