import assert from 'node:assert/strict';
import { contextChatRequest, contextNativeRequest, latestContext } from '@skaro/agent-runtime';
import type { RuntimeProcessIdentity, RouteSnapshot } from '@skaro/timeline';
import { extensionSession } from './extension-session';

/** Real lifecycle/command checks; this does not claim a direct provider API request. */
export async function verifyContextRoutes(directory: string, owner: RuntimeProcessIdentity) {
  const session = await extensionSession(directory, 'routes', owner);
  try {
    await session.execute({ id: 'refresh', action: { type: 'refreshContext' } });
    const original = structuredClone(session.journal.state.config!.route);
    let questionId: string | undefined;
    const unsubscribe = session.journal.subscribe((record) => {
      for (const fact of record.facts)
        if (fact.type === 'interaction' && fact.interaction.kind === 'question')
          questionId = fact.interaction.id;
    });
    const pending = session.execute({
      id: 'question',
      action: {
        type: 'tool',
        name: 'ask_user',
        args: {
          questions: [
            {
              id: 'route-check',
              header: 'Проверка',
              text: 'Сохранить решение о прямых API после смены маршрута?',
              multi: false,
              allowFreeText: true,
              options: [],
            },
          ],
        },
      },
    });
    for (let attempt = 0; !questionId && attempt < 100; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert(questionId, 'Actual runtime question was not published');
    const blocked = await session.execute({
      id: 'blocked',
      action: { type: 'setRoute', route: { ...original, routeRevision: 2 } },
    });
    assert.match(blocked.result.error!, /interaction|effect/);
    await session.execute({
      id: 'answer',
      action: {
        type: 'respond',
        interactionId: questionId,
        answer: {
          kind: 'question',
          answers: { 'route-check': ['Да, живые проверки прямых API позже.'] },
        },
      },
    });
    assert(!(await pending).result.error);
    unsubscribe();
    const profiles = [
      ['openai', 'https://api.openai.com/v1', 'openai.responses'],
      ['anthropic', 'https://api.anthropic.com', 'anthropic.messages'],
      ['deepseek', 'https://api.deepseek.com', 'deepseek.chat-completions'],
      ['openrouter', 'https://openrouter.ai/api/v1', 'openrouter.chat-completions'],
    ] as const;
    for (const [connector, endpoint, profile] of profiles) {
      await session.execute({ id: `compact-${connector}`, action: { type: 'compact' } });
      assert(session.journal.state.continuation);
      const route: RouteSnapshot = {
        ...original,
        connector,
        endpoint,
        routeId: connector,
        routeRevision: 2,
        connectionId: connector,
        apiProfile: { id: profile, revision: 1 },
      };
      const changed = await session.execute({
        id: `route-${connector}`,
        action: { type: 'setRoute', route },
      });
      assert(!changed.result.error, changed.result.error);
      assert.equal(session.journal.state.continuation, undefined);
      const request = contextChatRequest(session, {
        route,
        price: { prompt: 0.15, completion: 0.6 },
        messages: [{ role: 'user', content: 'Продолжай с сохранёнными решениями.' }],
      });
      assert(
        request.messages[0]!.content!.includes(
          'Продолжай код прямых коннекторов; живые проверки позже',
        ),
      );
      assert(request.messages[0]!.content!.includes('Да, живые проверки прямых API позже.'));
      assert(
        request.messages.every(
          (message) => message.role !== 'assistant' && message.role !== 'tool',
        ),
      );
      assert.throws(
        () =>
          contextChatRequest(session, {
            ...request,
            messages: [{ role: 'assistant', content: 'Rejected closed native host input' }],
          }),
        /fresh/,
      );
      const native = contextNativeRequest(session, {
        route,
        input: [{ role: 'user', content: 'Продолжай.' }],
      });
      assert(native.input.every((item) => item.role === 'user'));
      assert(native.system!.includes('Да, живые проверки прямых API позже.'));
    }
    const history = latestContext(session.journal)!.history;
    const current = structuredClone(session.journal.state.config!);
    await session.dispose();
    const { RuntimeSession } = await import('@skaro/agent-runtime');
    const resumed = await RuntimeSession.open(current, owner);
    try {
      assert.deepEqual(latestContext(resumed.journal)!.history, history);
    } finally {
      await resumed.dispose();
    }
    return {
      routeBoundaries: profiles.length,
      openQuestionBlocksChange: true,
      exactOwnerAnswerPreserved: true,
      freshChatAndNativeProjection: true,
      restart: true,
      modelRequests: 0,
    };
  } finally {
    await session.dispose();
  }
}
