import { expect, it, vi } from 'vitest';
import { AppServer } from './rpc.ts';
import { CodexSession } from './session.ts';

it('resumes a stored thread without fetching its full history and sends the next turn to it', async () => {
  // Intercept the unit-level transport; no substitute server or agent process is launched.
  const request = vi.fn(async (method: string) =>
    method === 'thread/resume' ? { thread: { id: 'stored-thread' }, model: 'stored-model' } : {},
  );
  const start = vi.spyOn(AppServer, 'start').mockResolvedValue({
    request,
    close: async () => undefined,
  } as unknown as AppServer);
  const session = new CodexSession(
    {
      cwd: process.cwd(),
      resume: 'stored-thread',
      permissionMode: 'auto',
      sandboxVerified: true,
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

  try {
    await session.start();
    expect(request).toHaveBeenCalledWith(
      'thread/resume',
      expect.objectContaining({ threadId: 'stored-thread', excludeTurns: true }),
    );
    await session.send({ text: 'continue the existing request' });
    expect(request).toHaveBeenCalledWith(
      'turn/start',
      expect.objectContaining({ threadId: 'stored-thread', model: 'stored-model' }),
    );
  } finally {
    await session.close();
    start.mockRestore();
  }
});
