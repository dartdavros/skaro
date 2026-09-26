import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDb, ArtifactStore, AttachmentStore } from '@skaro/core';
import { McpHttpServer, type SkaroScope } from '@skaro/mcp-server';
import {
  EventChannel,
  type AgentAdapter,
  type AgentSession,
  type Item,
  type SessionOptions,
  type TimelineEvent,
  type UserInput,
} from '@skaro/timeline';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentManager } from './agents';
import { ChatSessions } from './chats';
import { Projects } from './projects';

type ProposalItem = Extract<Item, { kind: 'proposal' }>;

/** An agent that answers every message at once and remembers what it got. */
class FakeSession implements AgentSession {
  readonly events = new EventChannel<TimelineEvent>();
  readonly received: string[] = [];
  private turn = 0;

  async send(input: UserInput): Promise<void> {
    this.received.push(input.text);
    const turnId = `t${++this.turn}`;
    this.events.push({ t: 'turn.started', turnId });
    this.events.push({
      t: 'item.upsert',
      item: {
        id: `u${this.turn}`,
        turnId,
        kind: 'message',
        role: 'user',
        text: input.text,
        status: 'done',
        startedAt: 0,
        native: { agent: 'fake', type: 'user', ref: '' },
      },
    });
    this.events.push({ t: 'turn.completed', turnId, outcome: 'done' });
  }
  steer = (input: UserInput) => this.send(input);
  respond = async () => undefined;
  setModel = async () => undefined;
  setPermissionMode = async () => undefined;
  rewind = async () => undefined;
  compact = async () => undefined;
  interrupt = async () => undefined;
  stopBackground = async () => undefined;
  close = async () => this.events.close();
}

let dataDir: string;
let root: string;
let db: AppDb;
let projects: Projects;
let mcp: McpHttpServer<SkaroScope>;
let chats: ChatSessions;
let session: FakeSession;
let started: SessionOptions | undefined;
let projectId: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'skaro-chats-data-'));
  root = await mkdtemp(join(tmpdir(), 'skaro-chats-project-'));
  await mkdir(join(root, '.skaro'), { recursive: true });
  const store = new ArtifactStore(root);
  await store.createTask({ title: 'Схема БД' });
  db = AppDb.open(':memory:');
  projectId = db.addProject({ name: 'Shop', path: root }).id;
  projects = new Projects(db, () => undefined);
  mcp = new McpHttpServer<SkaroScope>({ name: 'skaro', version: '0', tools: [] });
  await mcp.listen();
  session = new FakeSession();
  started = undefined;
  const adapter = {
    adapterVersion: 'fake',
    start: async (options: SessionOptions) => {
      started = options;
      return session;
    },
  } as unknown as AgentAdapter;
  const agents = {
    list: () => [{ id: 'claude-code', installed: true, authenticated: true, sizeBytes: 0 }],
    readyAgent: (preferred: string) => preferred,
    requireReady: async () => undefined,
    defaults: () => ({}),
    adapter: () => adapter,
    listModels: async () => [],
    sandbox: async () => ({ holds: true, detail: '' }),
  } as unknown as AgentManager;
  chats = new ChatSessions({
    db,
    dataDir,
    projects,
    agents,
    attachments: new AttachmentStore(join(dataDir, 'attachments')),
    mcp,
    emit: () => undefined,
    locale: () => 'ru',
  });
});

afterEach(async () => {
  await chats.close();
  await mcp.close();
  projects.close();
  db.close();
  await rm(dataDir, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

async function startChat(): Promise<{ chatId: string; scope: SkaroScope }> {
  const chat = await chats.create(
    projectId,
    { agent: 'claude-code', model: 'm', effort: 'e' },
    { text: '@src/a.ts\nДальше делаем платежи' },
  );
  await until(() => session.received.length === 1);
  return { chatId: chat.id, scope: { kind: 'project_chat', projectId, chatId: chat.id } };
}

async function proposals(chatId: string): Promise<ProposalItem[]> {
  const view = await chats.open(projectId, chatId);
  return view.timeline.items.filter((i): i is ProposalItem => i.kind === 'proposal');
}

describe('project chats', () => {
  it('runs the agent read-only in the project with Skaro tools and a title from the message', async () => {
    const { chatId } = await startChat();
    expect(started).toMatchObject({ cwd: root, readOnly: true, model: 'm', effort: 'e' });
    expect(started?.mcpServers?.['skaro']?.url).toBe(mcp.url);
    expect(chats.list(projectId)).toMatchObject([{ id: chatId, title: 'Дальше делаем платежи' }]);
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
          {
            title: 'Платежи',
            goal: 'Принимать оплату.',
            doneWhen: 'Оплата проходит.',
            tasks: [
              task('a', 'Модель платежа', ['T-001']),
              task('b', 'Webhook', ['a']),
              task('c', 'Возвраты', ['a']),
            ],
          },
        ],
      },
      scope,
    );
    const [plan] = await proposals(chatId);
    expect(plan?.proposal).toMatchObject({
      type: 'plan',
      milestone: { id: 'M01', title: 'Платежи', isNew: true },
    });
    await chats.proposal(projectId, chatId, plan!.id, { action: 'apply', tasks: ['a', 'b'] });

    const artifacts = await new ArtifactStore(root).load();
    expect(artifacts.milestones.map((m) => m.title)).toEqual(['Платежи']);
    const created = artifacts.tasks.filter((t) => t.milestone === 'M01');
    expect(created.map((t) => [t.title, t.dependsOn])).toEqual([
      ['Модель платежа', ['T-001']],
      ['Webhook', ['T-002']],
    ]);
    expect((await proposals(chatId))[0]?.result?.tasks?.map((t) => t.ref)).toEqual(['a', 'b']);

    // The decision reaches the agent with the next message, hidden from the feed.
    await chats.send(projectId, chatId, { text: 'Дальше' });
    await until(() => session.received.length === 2);
    expect(session.received[1]).toMatch(/^<skaro-note>\n.*M01.*Not taken: "Возвраты"/s);
    expect(session.received[1]).toMatch(/Дальше$/);
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

  it('keeps the chat after a restart and makes an archived chat read-only', async () => {
    const { chatId, scope } = await startChat();
    await chats.writeDoc({ path: 'brief.md', content: '# Бриф' }, scope);
    await chats.archive(projectId, chatId, true);
    await chats.close();

    const again = new ChatSessions({
      db,
      dataDir,
      projects,
      agents: {} as AgentManager,
      attachments: new AttachmentStore(join(dataDir, 'attachments')),
      mcp,
      emit: () => undefined,
      locale: () => 'ru',
    });
    const view = await again.open(projectId, chatId);
    expect(view.chat.archived).toBe(true);
    expect(view.timeline.items.some((i) => i.kind === 'proposal')).toBe(true);
    await expect(again.send(projectId, chatId, { text: 'ещё' })).rejects.toThrow(/archived/);
  });
});
