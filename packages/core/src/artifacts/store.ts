import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  getFields,
  parseMarkdown,
  serializeMarkdown,
  setFields,
  type MarkdownFile,
} from './frontmatter.ts';
import {
  DEFAULT_CONFIG,
  TASK_STATUSES,
  type Adr,
  type AdrStatus,
  type ArtifactProblem,
  type Doc,
  type Milestone,
  type ProjectArtifacts,
  type ProjectConfig,
  type Task,
  type TaskStatus,
} from './model.ts';
import { slugify } from './slug.ts';

export const SKARO_DIR = '.skaro';

export interface NewTask {
  title: string;
  milestone?: string;
  dependsOn?: string[];
  body?: string;
  agent?: string;
  model?: string;
  order?: number;
  created?: string;
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'milestone'
    | 'status'
    | 'dependsOn'
    | 'unblocked'
    | 'archived'
    | 'order'
    | 'agent'
    | 'model'
    | 'branch'
    | 'body'
  >
>;

export interface NewAdr {
  title: string;
  body?: string;
  status?: AdrStatus;
  replaces?: string;
  date?: string;
}

/**
 * Reads and writes the project's .skaro/ directory. Only Skaro writes here (D-17);
 * manual edits are picked up through `watch`.
 */
export class ArtifactStore {
  readonly root: string;
  private readonly dir: string;
  /** Content Skaro wrote last, per absolute path, so the watcher ignores our own writes. */
  private readonly ownWrites = new Map<string, string>();

  constructor(projectRoot: string) {
    this.root = projectRoot;
    this.dir = join(projectRoot, SKARO_DIR);
  }

  // ── reading ──────────────────────────────────────────────────────────────

  async load(): Promise<ProjectArtifacts> {
    const problems: ArtifactProblem[] = [];
    const config = await this.readConfig(problems);
    const brief = await this.readDoc('brief.md', 'brief', problems);
    const architecture = await this.readDoc('architecture.md', 'architecture', problems);
    const docs: Doc[] = [];
    for (const name of await this.list('docs')) {
      const doc = await this.readDoc(`docs/${name}`, 'doc', problems);
      if (doc) docs.push(doc);
    }
    const adrs = (await this.readAll('adr', problems, toAdr)).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const milestones = (await this.readAll('milestones', problems, toMilestone)).sort(
      (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    );
    const tasks = (await this.readAll('tasks', problems, toTask)).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    checkIds('task', tasks, problems);
    checkIds('milestone', milestones, problems);
    const taskIds = new Set(tasks.map((t) => t.id));
    const milestoneIds = new Set(milestones.map((m) => m.id));
    for (const task of tasks) {
      for (const dep of task.dependsOn) {
        if (!taskIds.has(dep))
          problems.push({ path: task.path, message: `unknown dependency ${dep}` });
      }
      if (task.milestone && !milestoneIds.has(task.milestone)) {
        problems.push({ path: task.path, message: `unknown milestone ${task.milestone}` });
      }
    }
    return { config, brief, architecture, docs, adrs, milestones, tasks, problems };
  }

  async readTask(id: string): Promise<Task> {
    return (await this.findFile('tasks', id, toTask)).item;
  }

  // ── tasks ────────────────────────────────────────────────────────────────

  async createTask(input: NewTask): Promise<Task> {
    const existing = await this.readAll('tasks', [], toTask);
    const id = `T-${String(
      nextNumber(
        existing.map((t) => t.id),
        /^T-(\d+)$/,
      ),
    ).padStart(3, '0')}`;
    const path = `tasks/${id}-${slugify(input.title)}.md`;
    const file = parseMarkdown('');
    setFields(file, {
      id,
      title: input.title,
      milestone: input.milestone,
      status: 'todo',
      depends_on: input.dependsOn ?? [],
      order: input.order,
      agent: input.agent,
      model: input.model,
      created: input.created ?? new Date().toISOString().slice(0, 10),
    });
    file.body = input.body ?? '## Цель\n\n## Критерии приёмки\n';
    await this.writeFile(path, serializeMarkdown(file));
    return this.readTask(id);
  }

  async updateTask(id: string, patch: TaskPatch): Promise<Task> {
    const { file, path } = await this.findFile('tasks', id, toTask);
    setFields(file, {
      ...('title' in patch ? { title: patch.title } : {}),
      ...('milestone' in patch ? { milestone: patch.milestone } : {}),
      ...('status' in patch ? { status: patch.status } : {}),
      ...('dependsOn' in patch ? { depends_on: patch.dependsOn } : {}),
      // Flags are written only while set, so ordinary task files stay short.
      ...('unblocked' in patch ? { unblocked: patch.unblocked || undefined } : {}),
      ...('archived' in patch ? { archived: patch.archived || undefined } : {}),
      ...('order' in patch ? { order: patch.order } : {}),
      ...('agent' in patch ? { agent: patch.agent } : {}),
      ...('model' in patch ? { model: patch.model } : {}),
      ...('branch' in patch ? { branch: patch.branch } : {}),
    });
    if (patch.body !== undefined) file.body = patch.body;
    await this.writeFile(path, serializeMarkdown(file));
    return this.readTask(id);
  }

  /** Deletes the task file and removes the task from other tasks' dependencies. */
  async deleteTask(id: string): Promise<void> {
    const { path } = await this.findFile('tasks', id, toTask);
    await rm(join(this.dir, path));
    this.ownWrites.delete(join(this.dir, path));
    for (const task of await this.readAll('tasks', [], toTask)) {
      if (task.dependsOn.includes(id)) {
        await this.updateTask(task.id, { dependsOn: task.dependsOn.filter((d) => d !== id) });
      }
    }
  }

  // ── milestones ───────────────────────────────────────────────────────────

  async createMilestone(input: {
    title: string;
    body?: string;
    order?: number;
  }): Promise<Milestone> {
    const existing = await this.readAll('milestones', [], toMilestone);
    const id = `M${String(
      nextNumber(
        existing.map((m) => m.id),
        /^M(\d+)$/,
      ),
    ).padStart(2, '0')}`;
    const order = input.order ?? Math.max(0, ...existing.map((m) => m.order)) + 1;
    const file = parseMarkdown('');
    setFields(file, { id, title: input.title, order });
    file.body = input.body ?? '## Цель\n\n## Критерий готовности\n';
    await this.writeFile(`milestones/${id}-${slugify(input.title)}.md`, serializeMarkdown(file));
    return (await this.findFile('milestones', id, toMilestone)).item;
  }

  async updateMilestone(
    id: string,
    patch: Partial<Pick<Milestone, 'title' | 'order' | 'body'>>,
  ): Promise<Milestone> {
    const { file, path } = await this.findFile('milestones', id, toMilestone);
    setFields(file, {
      ...('title' in patch ? { title: patch.title } : {}),
      ...('order' in patch ? { order: patch.order } : {}),
    });
    if (patch.body !== undefined) file.body = patch.body;
    await this.writeFile(path, serializeMarkdown(file));
    return (await this.findFile('milestones', id, toMilestone)).item;
  }

  /** Deletes a milestone; its tasks move to `moveTasksTo` or become unassigned. */
  async deleteMilestone(id: string, moveTasksTo?: string): Promise<void> {
    const { path } = await this.findFile('milestones', id, toMilestone);
    for (const task of await this.readAll('tasks', [], toTask)) {
      if (task.milestone === id) await this.updateTask(task.id, { milestone: moveTasksTo });
    }
    await rm(join(this.dir, path));
  }

  // ── ADR and documents ────────────────────────────────────────────────────

  async createAdr(input: NewAdr): Promise<Adr> {
    const existing = await this.readAll('adr', [], toAdr);
    const id = String(
      nextNumber(
        existing.map((a) => a.id),
        /^(\d+)$/,
      ),
    ).padStart(4, '0');
    const file = parseMarkdown('');
    setFields(file, {
      id,
      title: input.title,
      status: input.status ?? 'proposed',
      date: input.date ?? new Date().toISOString().slice(0, 10),
      replaces: input.replaces,
    });
    file.body = input.body ?? '## Контекст\n\n## Решение\n\n## Последствия\n';
    await this.writeFile(`adr/${id}-${slugify(input.title)}.md`, serializeMarkdown(file));
    if (input.replaces && input.status === 'accepted') await this.supersede(input.replaces, id);
    return (await this.findFile('adr', id, toAdr)).item;
  }

  /** Accepting an ADR that replaces another marks the old one superseded. */
  async setAdrStatus(id: string, status: AdrStatus): Promise<Adr> {
    const { file, path, item } = await this.findFile('adr', id, toAdr);
    setFields(file, { status });
    await this.writeFile(path, serializeMarkdown(file));
    if (status === 'accepted' && item.replaces) await this.supersede(item.replaces, id);
    return (await this.findFile('adr', id, toAdr)).item;
  }

  /** Writes brief.md, architecture.md or docs/<name>.md, keeping existing frontmatter. */
  async writeDoc(path: string, body: string): Promise<Doc> {
    if (!/^(brief\.md|architecture\.md|docs\/[^/]+\.md)$/.test(path))
      throw new Error(`not a document path: ${path}`);
    let file: MarkdownFile;
    try {
      file = parseMarkdown(await readFile(join(this.dir, path), 'utf8'));
    } catch {
      file = { doc: parseMarkdown('').doc, body: '' };
    }
    file.body = body;
    const hasFrontmatter = Object.keys(getFields(file)).length > 0;
    await this.writeFile(path, hasFrontmatter ? serializeMarkdown(file) : body);
    const kind =
      path === 'brief.md' ? 'brief' : path === 'architecture.md' ? 'architecture' : 'doc';
    const doc = await this.readDoc(path, kind, []);
    if (!doc) throw new Error(`failed to write ${path}`);
    return doc;
  }

  async writeConfig(config: ProjectConfig): Promise<void> {
    const yaml = stringifyYaml({
      default_agent: config.defaultAgent,
      default_model: config.defaultModel,
      base_branch: config.baseBranch,
      branch_template: config.branchTemplate,
      isolation: config.isolation,
      merge: { strategy: config.merge.strategy, delete_branch: config.merge.deleteBranch },
      chat: { auto_accept_docs: config.chat.autoAcceptDocs },
      agent_instructions: config.agentInstructions,
    });
    await this.writeFile('config.yaml', yaml);
  }

  // ── watching ─────────────────────────────────────────────────────────────

  /**
   * Reports paths (relative to .skaro/) changed outside Skaro, debounced.
   * Skaro's own writes are not reported.
   */
  watch(onChange: (paths: string[]) => void, debounceMs = 150): () => void {
    const pending = new Set<string>();
    let timer: NodeJS.Timeout | undefined;
    const flush = async () => {
      timer = undefined;
      const changed: string[] = [];
      for (const path of pending) {
        const abs = join(this.dir, path);
        const own = this.ownWrites.get(abs);
        if (own !== undefined) {
          const now = await readFile(abs, 'utf8').catch(() => undefined);
          if (now === own) continue;
          this.ownWrites.delete(abs);
        }
        changed.push(path.split(sep).join('/'));
      }
      pending.clear();
      if (changed.length) onChange(changed.sort());
    };
    let watcher: FSWatcher;
    try {
      watcher = watch(this.dir, { recursive: true }, (_event, name) => {
        if (!name) return;
        pending.add(name.toString());
        clearTimeout(timer);
        timer = setTimeout(() => void flush(), debounceMs);
      });
    } catch {
      return () => undefined; // no .skaro/ yet
    }
    return () => {
      clearTimeout(timer);
      watcher.close();
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async writeFile(path: string, content: string): Promise<void> {
    const abs = join(this.dir, path);
    await mkdir(dirname(abs), { recursive: true });
    this.ownWrites.set(abs, content);
    await writeFile(abs, content);
  }

  private async list(sub: string): Promise<string[]> {
    try {
      return (await readdir(join(this.dir, sub))).filter((n) => n.endsWith('.md')).sort();
    } catch {
      return [];
    }
  }

  private async readAll<T>(
    sub: string,
    problems: ArtifactProblem[],
    convert: (
      fields: Record<string, unknown>,
      body: string,
      path: string,
      problems: ArtifactProblem[],
    ) => T | undefined,
  ): Promise<T[]> {
    const out: T[] = [];
    for (const name of await this.list(sub)) {
      const path = `${sub}/${name}`;
      try {
        const file = parseMarkdown(await readFile(join(this.dir, path), 'utf8'));
        const item = convert(getFields(file), file.body, `${SKARO_DIR}/${path}`, problems);
        if (item) out.push(item);
      } catch (error) {
        problems.push({
          path: `${SKARO_DIR}/${path}`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return out;
  }

  private async findFile<T extends { id: string }>(
    sub: string,
    id: string,
    convert: (
      fields: Record<string, unknown>,
      body: string,
      path: string,
      problems: ArtifactProblem[],
    ) => T | undefined,
  ): Promise<{ file: MarkdownFile; path: string; item: T }> {
    for (const name of await this.list(sub)) {
      const path = `${sub}/${name}`;
      let file: MarkdownFile;
      try {
        file = parseMarkdown(await readFile(join(this.dir, path), 'utf8'));
      } catch {
        continue;
      }
      const item = convert(getFields(file), file.body, `${SKARO_DIR}/${path}`, []);
      if (item?.id === id) return { file, path, item };
    }
    throw new Error(`${sub}: ${id} not found`);
  }

  private async readDoc(
    path: string,
    kind: Doc['kind'],
    problems: ArtifactProblem[],
  ): Promise<Doc | undefined> {
    let text: string;
    try {
      text = await readFile(join(this.dir, path), 'utf8');
    } catch {
      return undefined;
    }
    let body = text;
    let title: string | undefined;
    try {
      const file = parseMarkdown(text);
      body = file.body;
      title = str(getFields(file)['title']);
    } catch (error) {
      problems.push({
        path: `${SKARO_DIR}/${path}`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    title ??= /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? path.split('/').pop()!.replace(/\.md$/, '');
    return { kind, title, body, path: `${SKARO_DIR}/${path}` };
  }

  private async readConfig(problems: ArtifactProblem[]): Promise<ProjectConfig> {
    let raw: Record<string, unknown> = {};
    try {
      const parsed = parseYaml(await readFile(join(this.dir, 'config.yaml'), 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        problems.push({ path: `${SKARO_DIR}/config.yaml`, message: String(error) });
      }
    }
    const merge = obj(raw['merge']);
    const chat = obj(raw['chat']);
    const strategy = str(merge['strategy']);
    const isolation = str(raw['isolation']);
    return {
      defaultAgent: str(raw['default_agent']) ?? DEFAULT_CONFIG.defaultAgent,
      defaultModel: str(raw['default_model']),
      baseBranch: str(raw['base_branch']) ?? DEFAULT_CONFIG.baseBranch,
      branchTemplate: str(raw['branch_template']) ?? DEFAULT_CONFIG.branchTemplate,
      isolation: isolation === 'in-place' ? 'in-place' : 'worktree',
      merge: {
        strategy: strategy === 'merge' ? 'merge' : 'squash',
        deleteBranch: typeof merge['delete_branch'] === 'boolean' ? merge['delete_branch'] : true,
      },
      chat: {
        autoAcceptDocs:
          typeof chat['auto_accept_docs'] === 'boolean' ? chat['auto_accept_docs'] : true,
      },
      agentInstructions: str(raw['agent_instructions']),
    };
  }

  private async supersede(oldId: string, newId: string): Promise<void> {
    const { file, path } = await this.findFile('adr', oldId, toAdr);
    setFields(file, { status: 'superseded', replaced_by: newId });
    await this.writeFile(path, serializeMarkdown(file));
  }
}

/** Branch name for a task from the config template (`skaro/{id}-{slug}`). */
export function taskBranch(config: ProjectConfig, task: Pick<Task, 'id' | 'title'>): string {
  return config.branchTemplate
    .replaceAll('{id}', task.id)
    .replaceAll('{slug}', slugify(task.title, 30));
}

// ── conversion ─────────────────────────────────────────────────────────────

function toTask(
  f: Record<string, unknown>,
  body: string,
  path: string,
  problems: ArtifactProblem[],
): Task | undefined {
  const id = str(f['id']);
  if (!id) {
    problems.push({ path, message: 'task without id' });
    return undefined;
  }
  let status = str(f['status']) as TaskStatus | undefined;
  if (!status || !TASK_STATUSES.includes(status)) {
    if (status) problems.push({ path, message: `unknown status "${status}"` });
    status = 'todo';
  }
  return {
    id,
    title: str(f['title']) ?? id,
    milestone: str(f['milestone']),
    status,
    dependsOn: strings(f['depends_on']),
    unblocked: f['unblocked'] === true,
    archived: f['archived'] === true,
    order: num(f['order']),
    agent: str(f['agent']),
    model: str(f['model']),
    branch: str(f['branch']),
    created: str(f['created']) ?? dateString(f['created']),
    body,
    path,
  };
}

function toMilestone(
  f: Record<string, unknown>,
  body: string,
  path: string,
  problems: ArtifactProblem[],
): Milestone | undefined {
  const id = str(f['id']);
  if (!id) {
    problems.push({ path, message: 'milestone without id' });
    return undefined;
  }
  return { id, title: str(f['title']) ?? id, order: num(f['order']) ?? 0, body, path };
}

function toAdr(
  f: Record<string, unknown>,
  body: string,
  path: string,
  problems: ArtifactProblem[],
): Adr | undefined {
  const id =
    str(f['id']) ?? (typeof f['id'] === 'number' ? String(f['id']).padStart(4, '0') : undefined);
  if (!id) {
    problems.push({ path, message: 'ADR without id' });
    return undefined;
  }
  const status = str(f['status']);
  return {
    id,
    title: str(f['title']) ?? id,
    status: status === 'accepted' || status === 'superseded' ? status : 'proposed',
    replaces: str(f['replaces']),
    replacedBy: str(f['replaced_by']),
    date: str(f['date']) ?? dateString(f['date']),
    body,
    path,
  };
}

function checkIds(
  kind: string,
  items: { id: string; path: string }[],
  problems: ArtifactProblem[],
): void {
  const seen = new Map<string, string>();
  for (const item of items) {
    const first = seen.get(item.id);
    if (first)
      problems.push({
        path: item.path,
        message: `duplicate ${kind} id ${item.id} (also in ${first})`,
      });
    else seen.set(item.id, item.path);
  }
}

function nextNumber(ids: string[], pattern: RegExp): number {
  let max = 0;
  for (const id of ids) max = Math.max(max, Number(pattern.exec(id)?.[1] ?? 0));
  return max + 1;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((s) => s.trim());
  return [];
}

function obj(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** YAML turns `2026-09-18` into a Date. */
function dateString(value: unknown): string | undefined {
  return value instanceof Date ? value.toISOString().slice(0, 10) : undefined;
}
