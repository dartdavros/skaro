import { expect, it, vi } from 'vitest';
import type { TimelineEvent } from '@skaro/timeline';
import { AppServer, type AppServerOptions } from './rpc.ts';
import { CodexSession } from './session.ts';
import { CODEX_DEFAULT_INSTRUCTIONS } from './interaction-instructions.ts';

it('enables Default-mode question cards without weakening full-access execution policy', async () => {
  // Intercept transport callbacks only; no substitute API or agent process is launched.
  let callbacks: AppServerOptions;
  let id = 0;
  const reply = vi.fn();
  const request = vi.fn(async (method: string, params?: unknown) => {
    const requestId = ++id;
    callbacks.onRaw?.('in', { id: requestId, method, params });
    const result =
      method === 'thread/start' ? { thread: { id: 'thread-1' }, model: 'model-1' } : {};
    callbacks.onRaw?.('out', { id: requestId, result });
    return result;
  });
  const start = vi.spyOn(AppServer, 'start').mockImplementation(async (options) => {
    callbacks = options;
    return { request, reply, close: async () => undefined } as unknown as AppServer;
  });
  const session = new CodexSession(
    {
      cwd: process.cwd(),
      permissionMode: 'full',
      raw: () => undefined,
      context: {
        now: Date.now,
        attachImage: () => {
          throw new Error('unexpected image');
        },
      },
    },
    {
      binary: 'unused',
      pathDirs: [],
      config: [
        'features.default_mode_request_user_input=false',
        'suppress_unstable_features_warning=false',
      ],
    },
  );
  const events: TimelineEvent[] = [];
  const pump = (async () => {
    for await (const event of session.events) events.push(event);
  })();
  try {
    await session.start();
    expect(callbacks!.config?.slice(-2)).toEqual([
      'features.default_mode_request_user_input=true',
      'suppress_unstable_features_warning=true',
    ]);
    expect(request).toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({ approvalPolicy: 'never', sandbox: 'danger-full-access' }),
    );
    await session.send({ text: 'continue the task' });
    expect(request).toHaveBeenCalledWith(
      'turn/start',
      expect.objectContaining({
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'dangerFullAccess' },
        collaborationMode: {
          mode: 'default',
          settings: {
            model: 'model-1',
            reasoning_effort: null,
            developer_instructions: CODEX_DEFAULT_INSTRUCTIONS,
          },
        },
      }),
    );
    const question = {
      id: 'question-1',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-1',
        questions: [
          { id: 'backend', header: 'Backend', question: 'Choose the backend.', options: [] },
        ],
      },
    };
    callbacks!.onRaw?.('out', question);
    callbacks!.onMessage?.(question);
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({
          t: 'interaction.opened',
          interaction: expect.objectContaining({ id: 'req-question-1', kind: 'question' }),
        }),
      ),
    );
    await session.respond('req-question-1', {
      kind: 'question',
      answers: { backend: ['Documented backend'] },
    });
    expect(reply).toHaveBeenCalledWith('question-1', {
      answers: { backend: { answers: ['Documented backend'] } },
    });
    callbacks!.onRaw?.('out', {
      method: 'warning',
      params: { message: 'MCP service connection warning' },
    });
    callbacks!.onRaw?.('out', {
      method: 'error',
      params: { error: { message: 'MCP service connection failed' }, willRetry: false },
    });
    await vi.waitFor(() => {
      for (const [level, text] of [
        ['warning', 'MCP service connection warning'],
        ['error', 'MCP service connection failed'],
      ])
        expect(events).toContainEqual(
          expect.objectContaining({
            t: 'item.upsert',
            item: expect.objectContaining({ kind: 'notice', level, text }),
          }),
        );
    });
  } finally {
    await session.close();
    await pump;
    start.mockRestore();
  }
});
