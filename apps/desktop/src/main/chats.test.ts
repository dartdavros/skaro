import { registerChatProposalChecks } from './chat-proposal-checks';
import { registerChatImportChecks } from './chat-import-checks';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
import { closeBackground } from './background/client';

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
  modes: string[] = [];
  setPermissionMode = async (mode: string) => void this.modes.push(mode);
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
  db = AppDb.open(join(dataDir, 'skaro.db'));
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
  await closeBackground();
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
  return view.timeline.items.filter(
    (i): i is ProposalItem => i.kind === 'proposal' && i.state !== 'superseded',
  );
}

describe('project chats', () => {
  registerChatProposalChecks(() => ({
    root,
    chats,
    projectId,
    session,
    startChat,
    proposals,
    until,
  }));
  registerChatImportChecks(() => ({
    dataDir,
    root,
    chats,
    projectId,
    session,
    started,
    proposals,
    until,
  }));
  it('runs the agent in the ask mode in the project with Skaro tools and a title from the message', async () => {
    const { chatId } = await startChat();
    expect(started).toMatchObject({ cwd: root, permissionMode: 'ask', model: 'm', effort: 'e' });
    expect(started?.readOnly).toBeUndefined();
    expect(started?.mcpServers?.['skaro']).toMatchObject({ type: 'http', url: mcp.url });
    expect(chats.list(projectId)).toMatchObject([{ id: chatId, title: 'Дальше делаем платежи' }]);
  });

  it('runs a chat with full access and switches its permission mode live', async () => {
    const chat = await chats.create(
      projectId,
      { agent: 'claude-code', model: 'm', effort: 'e', permissionMode: 'full' },
      { text: 'Распакуй архив' },
    );
    await until(() => session.received.length === 1);
    expect(started).toMatchObject({ permissionMode: 'full' });
    expect((await chats.open(projectId, chat.id)).settings.permissionMode).toBe('full');
    // A new chat starts asking again.
    expect((await chats.defaults(projectId)).permissionMode).toBeUndefined();

    await chats.setSettings(projectId, chat.id, { agent: 'claude-code', model: 'm', effort: 'e' });
    expect(session.modes).toEqual(['ask']);
    expect((await chats.open(projectId, chat.id)).settings.permissionMode).toBeUndefined();
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
