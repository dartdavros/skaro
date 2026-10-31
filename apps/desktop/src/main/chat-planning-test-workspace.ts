import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { ArtifactStore, AttachmentStore } from '@skaro/core';
import { McpHttpServer, type PreparePlanArgs, type SkaroScope } from '@skaro/mcp-server';
import { Timeline } from '@skaro/timeline';
import { AgentManager } from './agents';
import { AppState } from './state';
import { Projects } from './projects';
import { ChatEngine } from './chat-engine';
import { LiveChat } from './chat-model';
import { prepareFixtureArchitecture } from './c4-test-support';
import { closeBackground } from './background/client';

/** Only real storage/services. No HTTP listener, agent process, mocked API or agent session. */
export async function planningWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'skaro-planning-'));
  const state = new AppState(join(root, 'skaro.db'));
  const db = state.db;
  const store = new ArtifactStore(join(root, 'project'));
  for (let i = 1; i <= 19; i++) await store.createMilestone({ title: `Этап ${i}` });
  await store.createSpec({
    title: 'Обработка диалога',
    status: 'proposed',
    body:
      '## Требования\n\n' +
      Array.from({ length: 12 }, (_, i) => `- R-${i + 1} Реализовать функцию этапа ${i + 8}.`).join(
        '\n',
      ),
  });
  await prepareFixtureArchitecture(store.root, ['0001']);
  const project = db.addProject({ name: 'Planning verification', path: store.root });
  const chat = db.createChat({
    projectId: project.id,
    agent: 'codex',
    title: 'Планирование',
    logPath: 'chat.jsonl',
  });
  const projects = new Projects(db, () => undefined);
  const agents = new AgentManager({
    agentsDir: join(root, 'agents'),
    scratchDir: join(root, 'scratch'),
    store: state,
    openUrl: () => undefined,
    onChange: () => undefined,
  });
  const mcp = new McpHttpServer<SkaroScope>({ name: 'skaro', version: '0', tools: [] });
  const engine = new ChatEngine({
    db,
    dataDir: root,
    projects,
    agents,
    mcp,
    attachments: new AttachmentStore(join(root, 'attachments')),
    emit: () => undefined,
    locale: () => 'ru',
  });
  const live = new LiveChat(project.id, chat, new Timeline());
  engine.live.set(chat.id, live);
  return {
    root,
    db,
    store,
    engine,
    live,
    async close() {
      for (const entry of engine.live.values()) engine.planningContinuation.userMessage(entry);
      await Promise.all(
        [...engine.live.values()].map((entry) => engine.planningContinuation.settled(entry)),
      );
      engine.history.flush(live);
      if (live.log) {
        live.log.end();
        await finished(live.log);
      }
      projects.close();
      await closeBackground();
      db.close();
      if (
        dirname(resolve(root)) !== resolve(tmpdir()) ||
        !basename(root).startsWith('skaro-planning-')
      ) {
        throw new Error('Refusing cleanup outside the isolated test directory.');
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}

export function dialoguePlan(): PreparePlanArgs {
  const sizes = [8, 6, 6, 8, 5, 6, 6, 6, 6, 6, 6, 6];
  return {
    key: 'dialogue',
    title: 'Все функции диалога',
    expectedTotal: 75,
    milestones: sizes.map((size, index) => ({
      milestone: `M${String(index + 8).padStart(2, '0')}`,
      requirements: [`SPEC-0001:R-${index + 1}`],
      tasks: Array.from({ length: size }, (_, i) => ({
        ref: `m${index + 8}-${i}`,
        title: `Функция ${index + 8}, часть ${i + 1}`,
        goal: 'Реализовать часть согласованного поведения диалога.',
        criteria: ['Поведение соответствует спецификации.'],
        spec: '0001',
        requirements: [`SPEC-0001:R-${index + 1}`],
        dependsOn: index > 0 && i === 0 ? ['m8-0'] : [],
      })),
    })),
  };
}
