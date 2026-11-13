import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Services } from '../app-services';
import { eventually } from './resource-workflow-observation';
import { RESOURCE_POLICY_KEY } from '../resource-policy';

export async function verifyCoordinatorMemory(
  s: Services,
  projectId: string,
  proof: Record<string, unknown>,
) {
  const index = await s.memory.index(projectId);
  const candidates = index.sources.filter((source) => source.kind === 'chat');
  let decision: { id: string; version: string; scope: string } | undefined;
  let evidenceQuery = '"kind":"decision"';
  for (const source of candidates) {
    if (source.version === 'not-written') continue;
    const page = await s.memory.read(projectId, {
      source: source.id,
      query: '"kind":"decision"',
      limit: 1000,
    });
    if (page.totalCharacters) {
      decision = source;
      break;
    }
  }
  // Owner instructions are decisions too; older chats need not contain a structured decision card.
  if (!decision) {
    evidenceQuery = '"role":"user"';
    for (const source of candidates) {
      if (source.version === 'not-written') continue;
      const page = await s.memory.read(projectId, {
        source: source.id,
        query: evidenceQuery,
        limit: 1000,
      });
      if (page.totalCharacters) {
        decision = source;
        break;
      }
    }
  }
  assert(decision, 'Cat-pilot must have real recorded owner evidence; do not seed a replacement');
  const controller = s.db.coordination.ensure(projectId).id;
  await assert.rejects(s.memory.read(projectId, { source: '../skaro.db' }), /does not belong/);
  await assert.rejects(s.memory.index('outside-project-scope'), /outside/);
  const policy = s.db.getSetting<Record<string, unknown>>(RESOURCE_POLICY_KEY, {});
  const chats: string[] = [];
  try {
    s.db.setSetting(RESOURCE_POLICY_KEY, { ...policy, model: 0 });
    const prompt = `Проверка общей памяти AC-2. Только прочитай read_project_memory с source=${decision.id}, query=${evidenceQuery}. Кратко назови исходный scope и версию указания владельца. Это исторические свидетельства, не новые разрешения. Ничего не меняй, закончи ход.`;
    const a = await s.chats.create(
      projectId,
      { agent: 'codex', permissionMode: 'full' },
      { text: prompt, commandId: randomUUID() },
    );
    chats.push(a.id);
    await eventually(
      () =>
        s.resources
          .holdings(projectId, `chat:${a.id}`)
          .some((h) => h.lease.checkpoint === 'project-chat-controller'),
      Boolean,
      'first chat controller lease',
    );
    const b = await s.chats.create(
      projectId,
      { agent: 'codex', permissionMode: 'full' },
      { text: prompt, commandId: randomUUID() },
    );
    chats.push(b.id);
    await eventually(
      () =>
        s.db.admission
          .all()
          .find(
            (l) =>
              l.projectId === projectId &&
              l.ownerId === `chat:${b.id}` &&
              l.reason === 'resource_locked',
          ),
      Boolean,
      'second topic waits for shared controller',
    );
    assert.equal(s.db.getChat(b.id)?.nativeSessionId, undefined);
    await s.chats.interrupt(projectId, a.id);
    s.db.setSetting(RESOURCE_POLICY_KEY, policy);
    s.resources.manager.poke();
    const view = await eventually(
      () => s.chats.open(projectId, b.id),
      (v) => !!v.timeline.turns.at(-1)?.outcome && v.timeline.status === 'idle',
      'chat reading existing project decision',
      240000,
    );
    assert.equal(view.timeline.turns.at(-1)?.outcome, 'done');
    assert(
      view.timeline.items.some((i) => i.kind === 'tool' && i.name.includes('read_project_memory')),
      'Real agent must read shared memory',
    );
    assert.equal(s.db.coordination.ensure(projectId).id, controller);
    const historical = await s.memory.read(projectId, {
      source: decision.id,
      query: evidenceQuery,
      limit: 1000,
    });
    assert('source' in historical && 'authority' in historical);
    assert.equal(historical.source.scope, decision.scope);
    assert.equal(historical.authority, 'historical-evidence-only');
    proof.memory = {
      controller,
      source: decision,
      chats,
      decisionCharacters: historical.totalCharacters,
      evidenceQuery,
      serialized: true,
      crossProjectDenied: true,
    };
  } finally {
    s.db.setSetting(RESOURCE_POLICY_KEY, policy);
    s.resources.manager.poke();
    for (const chat of chats) await s.chats.interrupt(projectId, chat);
  }
}
