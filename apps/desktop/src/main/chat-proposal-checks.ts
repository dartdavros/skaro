import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArtifactStore } from '@skaro/core';
import type { SkaroScope } from '@skaro/mcp-server';
import type { Item } from '@skaro/timeline';
import { beforeEach, expect, it } from 'vitest';
import type { ChatSessions } from './chats';

type ProposalItem = Extract<Item, { kind: 'proposal' }>;
interface Context {
  root: string;
  chats: ChatSessions;
  projectId: string;
  session: { received: string[] };
  startChat: () => Promise<{ chatId: string; scope: SkaroScope }>;
  proposals: (chatId: string) => Promise<ProposalItem[]>;
  until: (check: () => boolean) => Promise<void>;
}

/** Existing chat assertions; the owning suite supplies its existing lifecycle. */
export function registerChatProposalChecks(context: () => Context): void {
  let root: string, chats: ChatSessions, projectId: string;
  let session: Context['session'], startChat: Context['startChat'];
  let proposals: Context['proposals'], until: Context['until'];
  beforeEach(() => {
    ({ root, chats, projectId, session, startChat, proposals, until } = context());
  });
  it('applies documents at once and rolls them back', async () => {
    const { chatId, scope } = await startChat();
    const reply = await chats.writeDoc({ path: 'brief.md', content: '# Бриф\n\nМагазин' }, scope);
    expect(reply.isError).toBeUndefined();
    const brief = join(root, '.skaro', 'brief.md');
    expect(await readFile(brief, 'utf8')).toBe('# Бриф\n\nМагазин\n');
    const [doc] = await proposals(chatId);
    expect(doc?.state).toBe('applied');

    await chats.proposal(projectId, chatId, doc!.id, { action: 'revert' });
    expect(existsSync(brief)).toBe(false);
    expect((await proposals(chatId))[0]?.state).toBe('reverted');
  });

  it('waits for the user when auto-apply is off', async () => {
    await writeFile(join(root, '.skaro', 'config.yaml'), 'chat:\n  auto_accept_docs: false\n');
    const { chatId, scope } = await startChat();
    await chats.writeDoc({ path: 'docs/api.md', content: '# API' }, scope);
    expect(existsSync(join(root, '.skaro', 'docs', 'api.md'))).toBe(false);
    const [doc] = await proposals(chatId);
    await chats.proposal(projectId, chatId, doc!.id, { action: 'apply' });
    expect(await readFile(join(root, '.skaro', 'docs', 'api.md'), 'utf8')).toBe('# API\n');
  });

  it('creates the picked tasks of a milestone with their dependencies', async () => {
    const { chatId, scope } = await startChat();
    const task = (ref: string, title: string, dependsOn: string[] = []) => ({
      ref,
      title,
      goal: `${title}.`,
      criteria: ['Готово'],
      dependsOn,
    });
    const bad = await chats.proposeTasks({ tasks: [task('x', 'X', ['nope'])] }, scope);
    expect(bad.isError).toBe(true);

    await chats.proposeMilestones(
      {
        milestones: [
          { title: 'Платежи', goal: 'Принимать оплату.', doneWhen: 'Оплата проходит.', tasks: [] },
        ],
      },
      scope,
    );
    const [milestone] = await proposals(chatId);
    await chats.proposal(projectId, chatId, milestone!.id, { action: 'apply' });
    await chats.planning.preparePlan(
      {
        key: 'payments',
        title: 'Платежи',
        expectedTotal: 3,
        milestones: [
          {
            milestone: 'M01',
            requirements: [],
            tasks: [
              task('a', 'Модель платежа', ['T-001']),
              task('b', 'Webhook', ['a']),
              task('c', 'Возвраты', ['a']),
            ].map((t) => ({ ...t, requirements: [] })),
          },
        ],
      },
      scope,
    );
    await chats.planning.proposeSavedPlan({ key: 'payments' }, scope);
    await chats.planning.finishPlan({ key: 'payments' }, scope);
    const plan = (await proposals(chatId)).at(-1);
    expect(plan?.proposal).toMatchObject({
      type: 'plan',
      complete: true,
      tasks: expect.arrayContaining([
        expect.objectContaining({ milestone: { id: 'M01', title: 'Платежи', isNew: false } }),
      ]),
    });
    await chats.proposal(projectId, chatId, plan!.id, {
      action: 'apply',
      tasks: ['plan:payments:a', 'plan:payments:b'],
    });

    const artifacts = await new ArtifactStore(root).load();
    expect(artifacts.milestones.map((m) => m.title)).toEqual(['Платежи']);
    const created = artifacts.tasks.filter((t) => t.milestone === 'M01');
    expect(created.map((t) => [t.title, t.dependsOn])).toEqual([
      ['Модель платежа', ['T-001']],
      ['Webhook', ['T-002']],
    ]);
    expect((await proposals(chatId)).at(-1)?.result?.tasks?.map((t) => t.ref)).toEqual([
      'plan:payments:a',
      'plan:payments:b',
    ]);

    // The decision reaches the agent with the next message, hidden from the feed.
    await chats.send(projectId, chatId, { text: 'Дальше' });
    await until(() => session.received.length === 2);
    expect(session.received[1]).toMatch(/^<skaro-note>\n.*M01.*Not taken: "Возвраты"/s);
    expect(session.received[1]).toMatch(/Дальше$/);
  });

  it('renames refs earlier cards used instead of rejecting a second plan', async () => {
    const { chatId, scope } = await startChat();
    const task = (ref: string, title: string, dependsOn: string[] = []) => ({
      ref,
      title,
      goal: `${title}.`,
      criteria: ['Готово'],
      dependsOn,
    });
    await chats.proposeTasks({ tasks: [task('a', 'Первая')] }, scope);
    await chats.proposeTasks({ tasks: [task('b', 'Вторая', ['a'])] }, scope);
    const again = await chats.proposeTasks({ tasks: [task('a', 'Новая')] }, scope);
    expect(again.isError).toBeFalsy();
    expect(again.text).toContain('a → a-2');
    await chats.proposeTasks({ tasks: [task('b', 'После новой', ['a-2'])] }, scope);

    const [plan] = await proposals(chatId);
    expect(plan?.proposal).toMatchObject({
      tasks: expect.arrayContaining([
        expect.objectContaining({ ref: 'a-2', dependsOn: [] }),
        expect.objectContaining({ ref: 'b-2', dependsOn: ['a-2'] }),
      ]),
    });
    await chats.proposal(projectId, chatId, plan!.id, { action: 'apply', tasks: ['a-2', 'b-2'] });
    const created = (await new ArtifactStore(root).load()).tasks.filter((t) =>
      ['Новая', 'После новой'].includes(t.title),
    );
    expect(created.map((t) => [t.title, t.dependsOn])).toEqual([
      ['Новая', []],
      ['После новой', [created[0]!.id]],
    ]);
  });

  it('changes a task and records a rejected ADR', async () => {
    const { chatId, scope } = await startChat();
    await chats.updateTask({ id: 't-001', title: 'Схема БД и миграции', goal: 'Таблицы.' }, scope);
    await chats.proposeAdr(
      { title: 'Очередь', context: 'К', decision: 'Р', consequences: 'П' },
      scope,
    );
    const [change, adr] = await proposals(chatId);
    expect(adr?.proposal).toMatchObject({ type: 'adr', id: '0001' });
    await chats.proposal(projectId, chatId, change!.id, { action: 'apply' });
    await chats.proposal(projectId, chatId, adr!.id, { action: 'reject' });
    const task = await new ArtifactStore(root).readTask('T-001');
    expect(task.title).toBe('Схема БД и миграции');
    expect(task.body).toContain('Таблицы.');
    expect((await proposals(chatId)).map((p) => p.state)).toEqual(['applied', 'rejected']);
  });

  it('accepts and edits a specification in project chat without building C4', async () => {
    const spec = '## Проблема\n\nВозвраты вручную.\n\n## Требования\n\n- R-1 Полный возврат\n';
    const store = new ArtifactStore(root);
    const { chatId, scope } = await startChat();
    const proposed = await chats.proposeSpec({ title: 'Возвраты', content: spec }, scope);
    expect(proposed.isError).not.toBe(true);
    const specification = (await proposals(chatId)).at(-1)!;
    await chats.proposal(projectId, chatId, specification.id, { action: 'apply' });
    let artifacts = await store.load();
    expect(artifacts.specs.map((s) => [s.id, s.title, s.status])).toEqual([
      ['0001', 'Возвраты', 'accepted'],
    ]);

    const unknown = await chats.proposeTasks(
      { tasks: [{ ref: 'x', title: 'X', goal: 'g', criteria: ['c'], dependsOn: [], spec: '9' }] },
      scope,
    );
    expect(unknown.isError).toBe(true);
    const offered = await chats.proposeTasks(
      {
        tasks: [
          { ref: 'r', title: 'Возврат', goal: 'g', criteria: ['c'], dependsOn: [], spec: '1' },
        ],
      },
      scope,
    );
    expect(offered.isError, offered.text).not.toBe(true);
    const plan = (await proposals(chatId)).at(-1)!;
    await chats.proposal(projectId, chatId, plan.id, { action: 'apply' });

    const change = await chats.proposeSpec(
      { id: '0001', content: `${spec}- R-2 Частичный возврат\n` },
      scope,
    );
    expect(change.isError).not.toBe(true);
    const revision = (await proposals(chatId)).at(-1)!;
    await chats.proposal(projectId, chatId, revision.id, { action: 'apply' });
    artifacts = await new ArtifactStore(root).load();
    expect(artifacts.tasks.find((t) => t.title === 'Возврат')?.spec).toBe('0001');
    expect(artifacts.specs[0]?.body).toContain('R-2 Частичный возврат');
  });
}
