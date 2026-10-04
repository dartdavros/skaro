import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineEvent } from '@skaro/timeline';
import { AppServer, type AppServerOptions } from './rpc.ts';
import { CodexSession } from './session.ts';
import { PERMISSION_CONTINUATION } from './session-input.ts';

// Unit-level transport interception only; no substitute server or agent process is launched.
let callbacks: AppServerOptions;
let session: CodexSession;
let events: TimelineEvent[];
let nextId: number;
const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();
const reply = vi.fn();

function output(line: Record<string, unknown>): void {
  callbacks.onRaw?.('out', line);
  callbacks.onMessage?.(line);
}

function finish(status = 'interrupted', id = 'turn-1'): void {
  output({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id, status } } });
}

function starts(): Record<string, unknown>[] {
  return request.mock.calls
    .filter(([method]) => method === 'turn/start')
    .map(([, p]) => p as Record<string, unknown>);
}

function newSession(planFirst = false): CodexSession {
  const value = new CodexSession(
    {
      cwd: process.cwd(),
      permissionMode: 'auto',
      sandboxVerified: true,
      model: 'model-1',
      effort: 'low',
      planFirst,
      raw: () => undefined,
      context: {
        now: Date.now,
        attachImage: () => {
          throw new Error('unexpected image');
        },
      },
    },
    { binary: 'unused', pathDirs: [] },
  );
  void (async () => {
    for await (const event of value.events) events.push(event);
  })();
  return value;
}

beforeEach(async () => {
  nextId = 0;
  events = [];
  request.mockReset();
  reply.mockReset();
  request.mockImplementation(async (method, params) => {
    const id = ++nextId;
    callbacks.onRaw?.('in', { id, method, params });
    const result =
      method === 'thread/start' ? { thread: { id: 'thread-1' }, model: 'model-1' } : {};
    output({ id, result });
    if (method === 'turn/start') {
      output({
        method: 'turn/started',
        params: { threadId: 'thread-1', turn: { id: `turn-${starts().length}` } },
      });
    }
    return result;
  });
  vi.spyOn(AppServer, 'start').mockImplementation(async (options) => {
    callbacks = options;
    return {
      request,
      reply,
      close: async () => callbacks.onExit?.(0, null),
    } as unknown as AppServer;
  });
  session = newSession();
  await session.start();
});

afterEach(async () => {
  await session.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('permission changes in a running Codex session', () => {
  it('waits for completion, expires the old approval and resumes the same thread with full access', async () => {
    await session.send({ text: 'original request' });
    output({
      id: 'permission-1',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread-1', turnId: 'turn-1', command: 'git status', itemId: 'cmd-1' },
    });
    const changed = session.setPermissionMode('full');
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('turn/interrupt', {
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    );
    expect(starts()).toHaveLength(1);
    finish();
    await changed;
    expect(starts()[1]).toMatchObject({
      threadId: 'thread-1',
      model: 'model-1',
      effort: 'low',
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' },
      collaborationMode: { mode: 'default' },
    });
    expect(events).toContainEqual(
      expect.objectContaining({ t: 'turn.completed', outcome: 'interrupted', continuing: true }),
    );
    await expect(
      session.respond('req-permission-1', { kind: 'approval', choice: 'allow_once' }),
    ).rejects.toThrow('no open interaction');
    expect(reply).not.toHaveBeenCalled();
  });

  it('also interrupts when reducing full access', async () => {
    await session.setPermissionMode('full');
    await session.send({ text: 'start' });
    const changed = session.setPermissionMode('auto');
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('turn/interrupt', expect.anything()),
    );
    finish();
    await changed;
    expect(starts()[1]).toMatchObject({
      approvalPolicy: 'on-request',
      sandboxPolicy: { type: 'workspaceWrite' },
    });
  });

  it('changes an idle session without starting work or approving a pending plan', async () => {
    await session.send({ text: 'start' });
    finish('completed');
    await session.setPermissionMode('full');
    expect(starts()).toHaveLength(1);
    expect(request.mock.calls.some(([m]) => m === 'turn/interrupt')).toBe(false);
    await session.send({ text: 'next request' });
    expect(starts()[1]).toMatchObject({ approvalPolicy: 'never' });
  });

  it('does not restart for the same mode', async () => {
    await session.send({ text: 'start' });
    await session.setPermissionMode('auto');
    expect(starts()).toHaveLength(1);
    expect(request.mock.calls.some(([m]) => m === 'turn/interrupt')).toBe(false);
  });

  it.each(['completed', 'failed'])('does not resume a turn that finishes as %s', async (status) => {
    await session.send({ text: 'start' });
    const changed = session.setPermissionMode('full');
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('turn/interrupt', expect.anything()),
    );
    finish(status);
    await changed;
    expect(starts()).toHaveLength(1);
  });

  it('respects a manual stop while the permission change is waiting', async () => {
    await session.send({ text: 'start' });
    const changed = session.setPermissionMode('full');
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('turn/interrupt', expect.anything()),
    );
    const stopped = session.interrupt();
    finish();
    await Promise.all([changed, stopped]);
    expect(starts()).toHaveLength(1);
    expect(events.filter((e) => e.t === 'turn.completed').at(-1)).not.toHaveProperty('continuing');
  });

  it('keeps plan mode and hides the internal continuation from the user feed', async () => {
    await session.close();
    session = newSession(true);
    await session.start();
    await session.send({ text: 'plan the change' });
    const changed = session.setPermissionMode('full');
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('turn/interrupt', expect.anything()),
    );
    finish();
    await changed;
    expect(starts()[1]).toMatchObject({
      collaborationMode: { mode: 'plan' },
      input: [{ type: 'text', text: PERMISSION_CONTINUATION }],
    });
    output({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-2',
        item: {
          id: 'internal',
          type: 'userMessage',
          content: [{ type: 'text', text: PERMISSION_CONTINUATION }],
        },
      },
    });
    await Promise.resolve();
    expect(events.some((e) => e.t === 'item.upsert' && e.item.id === 'internal')).toBe(false);
    output({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-2',
        item: {
          id: 'steered',
          type: 'userMessage',
          content: [{ type: 'text', text: 'new user instruction' }],
        },
      },
    });
    await Promise.resolve();
    expect(events.some((e) => e.t === 'item.upsert' && e.item.id === 'steered')).toBe(true);
  });

  it('releases the task when a manual stop arrives after completion but before the interrupt reply', async () => {
    await session.send({ text: 'start' });
    const original = request.getMockImplementation()!;
    let release!: () => void;
    request.mockImplementation((method, params) =>
      method === 'turn/interrupt'
        ? new Promise<void>((resolve) => (release = resolve))
        : original(method, params),
    );
    const changed = session.setPermissionMode('full');
    await vi.waitFor(() => expect(release).toBeDefined());
    finish();
    const stopped = session.interrupt();
    release();
    await Promise.all([changed, stopped]);
    expect(starts()).toHaveLength(1);
    expect(events.filter((e) => e.t === 'turn.completed').at(-1)).not.toHaveProperty('continuing');
  });

  it('rejects an unconfirmed interruption and leaves the original permission mode for retry', async () => {
    await session.send({ text: 'start' });
    vi.useFakeTimers();
    const changed = session.setPermissionMode('full');
    const rejected = expect(changed).rejects.toThrow('did not finish interrupting');
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(starts()).toHaveLength(1);
    finish('completed');
    await session.send({ text: 'next request' });
    expect(starts()[1]).toMatchObject({ approvalPolicy: 'on-request' });
  });

  it('serializes a message sent during switching behind the resumed turn', async () => {
    await session.send({ text: 'start' });
    const changed = session.setPermissionMode('full');
    const message = session.steer({ text: 'additional instruction' });
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('turn/interrupt', expect.anything()),
    );
    expect(request.mock.calls.some(([m]) => m === 'turn/steer')).toBe(false);
    finish();
    await Promise.all([changed, message]);
    expect(request.mock.calls.at(-1)).toEqual([
      'turn/steer',
      expect.objectContaining({ expectedTurnId: 'turn-2' }),
    ]);
  });

  it('reports a failed continuation so the task can release its slot', async () => {
    await session.send({ text: 'start' });
    const original = request.getMockImplementation()!;
    request.mockImplementation((method, params) =>
      method === 'turn/start'
        ? Promise.reject(new Error('resume failed'))
        : original(method, params),
    );
    const changed = session.setPermissionMode('full');
    const rejected = expect(changed).rejects.toThrow('resume failed');
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('turn/interrupt', expect.anything()),
    );
    finish();
    await rejected;
    expect(events).toContainEqual(
      expect.objectContaining({ t: 'turn.completed', turnId: 'turn-1', outcome: 'failed' }),
    );
  });
});
