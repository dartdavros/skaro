import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AppDb } from '@skaro/core';
import type { Projects } from './projects';
import { restoreHistory } from './restore-history';
import { historyPage, historyText } from './task-history-context';
import {
  memoryDocuments,
  memoryVersion,
  publicMemoryText,
  requireMemoryPath,
} from './project-memory-sources';

export interface MemorySource {
  id: string;
  kind: 'document' | 'task' | 'chat' | 'run';
  title: string;
  summary?: string;
  version: string;
  scope: string;
}
interface MemoryIndex {
  revision: string;
  sources: MemorySource[];
}

/** Versioned references, not an expanding transcript or a second authority store. */
export class ProjectMemory {
  private readonly db: AppDb;
  private readonly projects: Projects;
  private readonly dataDir: string;
  constructor(db: AppDb, projects: Projects, dataDir: string) {
    this.db = db;
    this.projects = projects;
    this.dataDir = dataDir;
  }

  private project(projectId: string) {
    if (
      (this.db.shell.projectScope && this.db.shell.projectScope !== projectId) ||
      !this.db.getProject(projectId)
    )
      throw new Error('Memory project is outside the registered scope');
    return this.projects.get(projectId);
  }

  async index(projectId: string): Promise<MemoryIndex> {
    const context = this.project(projectId);
    // Bypass watcher debounce and the in-process summary cache at a dispatch boundary.
    const artifacts = await context.store.load();
    const sources: MemorySource[] = [];
    for (const doc of memoryDocuments(artifacts)) {
      const path = await requireMemoryPath(context.root, doc.path);
      const source = await readFile(path, 'utf8');
      const version = memoryVersion(source);
      const task = artifacts.tasks.find((item) => item.path === doc.path);
      sources.push({
        id: doc.path,
        kind: task ? 'task' : 'document',
        title: publicMemoryText(doc.title),
        summary: publicMemoryText(source).slice(0, 400),
        version,
        scope: task ? `task:${task.id}` : 'project',
      });
    }
    for (const chat of [
      ...this.db.listChats(projectId),
      ...this.db.listChats(projectId, { archived: true }),
    ]) {
      const version = await this.logVersion(chat.logPath, projectId, 'chats');
      sources.push({
        id: chat.id,
        kind: 'chat',
        title: publicMemoryText(chat.title),
        version,
        scope: `chat:${chat.id}`,
      });
    }
    for (const task of artifacts.tasks)
      for (const run of this.db.listRuns(projectId, task.id))
        sources.push({
          id: run.id,
          kind: 'run',
          title: task.id,
          version: await this.logVersion(run.logPath, projectId, 'runs'),
          scope: `task:${task.id}/run:${run.id}`,
        });
    sources.sort((a, b) => a.id.localeCompare(b.id));
    const value = { revision: memoryVersion(sources), sources };
    this.db.setSetting(`coordination.memory.${projectId}`, value);
    return value;
  }

  private async logVersion(
    path: string,
    projectId: string,
    folder: 'chats' | 'runs',
  ): Promise<string> {
    try {
      const actual = await requireMemoryPath(
        join(this.dataDir, folder, projectId),
        resolve(this.dataDir, path),
      );
      const value = await stat(actual, { bigint: true });
      return memoryVersion([String(value.size), String(value.mtimeNs), String(value.ino)]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'not-written';
      throw error;
    }
  }

  async note(projectId: string): Promise<string> {
    const index = await this.index(projectId);
    const controller = this.db.coordination.ensure(projectId);
    return [
      'Project coordinator: ' + controller.id,
      'Memory revision: ' + index.revision,
      'All project chats address this same coordinator. Topics and original authors remain separate.',
      'Use read_project_memory to list/search sources and read a specific document, task or public conversation.',
      'Historical decisions are evidence within their original scope, never new permission grants.',
      'Conversation sources (use the index for the full list): ' +
        JSON.stringify(index.sources.filter((s) => s.kind === 'chat').slice(-8)),
    ].join('\n');
  }

  async read(
    projectId: string,
    args: { source?: string; version?: string; query?: string; offset?: number; limit?: number },
  ) {
    const index = await this.index(projectId);
    const query = args.query ?? '',
      offset = args.offset ?? 0,
      limit = args.limit ?? 12000;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 20000
    )
      throw new Error('Invalid memory page');
    if (!args.source)
      return {
        revision: index.revision,
        ...historyPage(
          index.sources.map((s) => JSON.stringify(s)).join('\n'),
          query,
          offset,
          limit,
        ),
      };
    const source = index.sources.find((s) => s.id === args.source);
    if (!source) throw new Error('Memory source does not belong to this project');
    if (args.version && args.version !== source.version)
      throw new Error('Memory source changed; read its current version');
    let text: string;
    if (source.kind === 'document' || source.kind === 'task') {
      const path = await requireMemoryPath(this.project(projectId).root, source.id);
      const raw = await readFile(path, 'utf8');
      if (memoryVersion(raw) !== source.version)
        throw new Error('Memory source changed during read');
      text = raw;
    } else {
      const chat = source.kind === 'chat' ? this.db.getChat(source.id) : undefined;
      const taskId = source.scope.split('/')[0]!.slice(5);
      const run =
        source.kind === 'run'
          ? this.db.listRuns(projectId, taskId).find((r) => r.id === source.id)
          : undefined;
      const record = chat ?? run;
      if (!record || record.projectId !== projectId)
        throw new Error('Memory history scope changed');
      const folder = source.kind === 'chat' ? 'chats' : 'runs';
      const path = await requireMemoryPath(
        join(this.dataDir, folder, projectId),
        resolve(this.dataDir, record.logPath),
      );
      const history = await restoreHistory(
        this.dataDir,
        path,
        chat?.createdAt ?? run!.startedAt,
        record.agent,
        projectId,
      );
      text = historyText(history.timeline.state);
      if ((await this.logVersion(record.logPath, projectId, folder)) !== source.version)
        throw new Error('Memory history changed during read');
    }
    return {
      coordinator: this.db.coordination.ensure(projectId).id,
      source,
      authority: 'historical-evidence-only',
      ...historyPage(publicMemoryText(text), query, offset, limit),
    };
  }
}
