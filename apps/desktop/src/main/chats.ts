// Project chats (architecture.md 9, agent-output.md 5.4): an agent session per chat in the
// project's main working copy, in the "ask" mode (the user confirms edits and commands in cards)
// or with full access, with Skaro's tools for documents, ADRs, milestones and
// tasks. The agent's proposals are items of the chat timeline; the user decides on them in cards,
// and the decisions reach the agent with the user's next message.

import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  displayStatus,
  indexTasks,
  type AppDb,
  type AttachmentStore,
  type ChatRecord,
  type ProjectArtifacts,
  type Task,
} from '@skaro/core';
import type {
  Grant,
  McpHttpServer,
  ProjectToolHandlers,
  FinishImportArgs,
  ProposeAdrArgs,
  ProposeSpecArgs,
  StageArtifactArgs,
  ProposedTaskArgs,
  ProposeMilestonesArgs,
  ProposeTasksArgs,
  SkaroScope,
  ToolResult,
  UpdateTaskArgs,
  WriteDocArgs,
} from '@skaro/mcp-server';
import {
  countSegments,
  replayRunLog,
  segmentTurns,
  Timeline,
  withSkaroNote,
  type AgentSession,
  type InteractionAnswer,
  type Item,
  type Proposal,
  type ProposalResult,
  type ProposedTask,
  type RawLine,
  type TimelineEvent,
} from '@skaro/timeline';
import type {
  AgentId,
  ChatSettings,
  ChatSummary,
  ChatView,
  EventName,
  Events,
  ImportReview,
  ImportSource,
  MessageInput,
  ProposalAction,
} from '../shared/ipc';
import {
  applyImport,
  ChangedOnDisk,
  currentText,
  docName,
  importGroups,
  loadManifest,
  loadState,
  removeImport,
  saveState,
  scanSource,
  snapshot,
  type ImportState,
  type Manifest,
  type StagedArtifact,
} from './imports';
import { hasCode } from './new-project';
import { milestoneBody, milestoneSections } from './plan';
import type { AgentManager } from './agents';
import type { ProjectContext, Projects } from './projects';
import { chatInstructions, importInstructions } from './prompt';
import { errorText, projectorFor, readRunLog, withoutSecrets } from './session-log';
import { headings, taskBody, taskSections, withSections } from './task-body';

type ProposalItem = Extract<Item, { kind: 'proposal' }>;
type PlanProposal = Extract<Proposal, { type: 'plan' }>;

interface Deps {
  db: AppDb;
  /** App data folder: chats/. */
  dataDir: string;
  projects: Projects;
  agents: AgentManager;
  attachments: AttachmentStore;
  mcp: McpHttpServer<SkaroScope>;
  emit: <E extends EventName>(event: E, payload: Events[E]) => void;
  locale: () => string;
}

/** A chat with its timeline, with or without an agent process attached. */
class LiveChat {
  readonly projectId: string;
  chat: ChatRecord;
  readonly timeline: Timeline;
  session: AgentSession | undefined;
  grant: Grant | undefined;
  log: WriteStream | undefined;
  /** Events not yet sent to the renderer. */
  pending: TimelineEvent[] = [];
  /** Events applied to the timeline so far. */
  seq = 0;
  /** Agent processes the run log holds so far ("segment" lines); turns are numbered per segment. */
  segments = 0;
  flushTimer: NodeJS.Timeout | undefined;
  /** Serializes session start and resume. */
  attaching: Promise<AgentSession> | undefined;

  constructor(projectId: string, chat: ChatRecord, timeline: Timeline) {
    this.projectId = projectId;
    this.chat = chat;
    this.timeline = timeline;
  }
}

const FLUSH_MS = 40;
/** Documents the chat writes (architecture.md 3): the brief, the architecture, free documents. */
const DOC_PATH = /^(brief\.md|architecture\.md|docs\/[^/\\]+\.md)$/;

export class ChatSessions implements ProjectToolHandlers {
  private readonly deps: Deps;
  private readonly live = new Map<string, LiveChat>();

  constructor(deps: Deps) {
    this.deps = deps;
  }

  // ── list and views ───────────────────────────────────────────────────────

  list(projectId: string): ChatSummary[] {
    const { db } = this.deps;
    return [...db.listChats(projectId), ...db.listChats(projectId, { archived: true })]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((chat) => this.summary(chat));
  }

  /** A new chat starts with the agent of the last chat, else the project's default agent. */
  async defaults(projectId: string): Promise<ChatSettings> {
    const { agents } = this.deps;
    const last = this.deps.db.getSetting<ChatSettings | null>(lastKey(projectId), null);
    if (last && agents.readyAgent(last.agent) === last.agent) return last;
    const { config } = await this.project(projectId).load();
    const configured = config.defaultAgent === 'codex' ? 'codex' : 'claude-code';
    // An absent agent is inactive: a new chat starts with a ready one.
    const agent = agents.readyAgent(configured);
    return {
      agent,
      ...(agent === configured && config.defaultModel ? { model: config.defaultModel } : {}),
      ...(agent === configured && config.defaultModel && config.defaultEffort
        ? { effort: config.defaultEffort }
        : {}),
    };
  }

  async open(projectId: string, chatId: string): Promise<ChatView> {
    const live = await this.restore(projectId, chatId);
    return {
      projectId,
      chat: this.summary(live.chat),
      settings: this.settings(live.chat),
      timeline: live.timeline.state,
      seq: live.seq,
    };
  }

  // ── conversation ─────────────────────────────────────────────────────────

  /** A chat starts with its first message; the agent is fixed from then on (D-24). */
  async create(
    projectId: string,
    settings: ChatSettings,
    input: MessageInput,
  ): Promise<ChatSummary> {
    this.project(projectId);
    await this.ensureAgent(settings.agent);
    const chat = this.deps.db.createChat({
      projectId,
      agent: settings.agent,
      title: titleOf(input.text),
      logPath: join('chats', projectId, `${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`),
    });
    this.deps.db.setSetting(settingsKey(chat.id), saved(settings));
    this.deps.db.setSetting(lastKey(projectId), lastOf(settings));
    const live = new LiveChat(projectId, chat, new Timeline());
    this.live.set(chat.id, live);
    this.listChanged(projectId, chat.id);
    // Starting the agent takes a while; failures show in the chat itself.
    void this.deliver(live, input).catch((error: unknown) => this.failTurn(live, error));
    return this.summary(chat);
  }

  async send(projectId: string, chatId: string, input: MessageInput): Promise<void> {
    const live = await this.restore(projectId, chatId);
    if (live.chat.archived) throw new Error('The chat is archived');
    this.touch(live);
    await this.deliver(live, input);
  }

  /** Sends a message; decisions on proposals since the last message go in front of it. */
  private async deliver(live: LiveChat, input: MessageInput): Promise<void> {
    const session = await this.attach(live);
    const notes = this.takeNotes(live.chat.id);
    const message = { ...input, text: withSkaroNote(notes.join('\n'), input.text) };
    try {
      if (live.timeline.state.status === 'idle') await session.send(message);
      else await session.steer(message);
    } catch (error) {
      this.addNotes(live.chat.id, notes);
      throw error;
    }
  }

  async respond(
    projectId: string,
    chatId: string,
    interactionId: string,
    answer: InteractionAnswer,
  ): Promise<void> {
    const live = await this.restore(projectId, chatId);
    if (!live.session) throw new Error('The agent session has ended');
    const interaction = live.timeline.state.interactions.find((i) => i.id === interactionId);
    await live.session.respond(interactionId, answer);
    if (!interaction) return;
    this.skaroEvent(live, {
      t: 'item.upsert',
      item: {
        id: `skaro-decision-${interactionId}`,
        turnId: currentTurn(live),
        kind: 'decision',
        interaction,
        answer: withoutSecrets(interaction, answer),
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'decision', ref: interactionId },
      },
    });
  }

  async interrupt(projectId: string, chatId: string): Promise<void> {
    await (await this.restore(projectId, chatId)).session?.interrupt();
  }

  async rewind(
    projectId: string,
    chatId: string,
    itemId: string,
    resend?: MessageInput,
  ): Promise<void> {
    const live = await this.restore(projectId, chatId);
    if (live.chat.archived) throw new Error('The chat is archived');
    const session = await this.attach(live);
    await session.rewind(itemId);
    if (resend) await this.deliver(live, resend);
  }

  /** Model, effort and permission mode change in a live session; the agent itself never changes. */
  async setSettings(projectId: string, chatId: string, next: ChatSettings): Promise<void> {
    const live = await this.restore(projectId, chatId);
    if (next.agent !== live.chat.agent) {
      throw new Error('The agent of a started chat cannot be changed');
    }
    const before = this.settings(live.chat);
    this.deps.db.setSetting(settingsKey(chatId), saved(next));
    this.deps.db.setSetting(lastKey(projectId), lastOf(next));
    if (
      live.session &&
      next.model &&
      (next.model !== before.model || next.effort !== before.effort)
    )
      await live.session.setModel(next.model, next.effort);
    const mode = next.permissionMode ?? 'ask';
    if (live.session && mode !== (before.permissionMode ?? 'ask'))
      await live.session.setPermissionMode(mode);
    this.listChanged(projectId, chatId);
  }

  /** An archived chat is read-only: its agent process stops. */
  async archive(projectId: string, chatId: string, archived: boolean): Promise<void> {
    const live = await this.restore(projectId, chatId);
    this.deps.db.updateChat(chatId, { archived });
    live.chat = this.deps.db.getChat(chatId)!;
    if (archived) await this.detach(live);
    this.listChanged(projectId, chatId);
  }

  // ── proposals: the user's decisions ──────────────────────────────────────

  async proposal(
    projectId: string,
    chatId: string,
    itemId: string,
    action: ProposalAction,
  ): Promise<void> {
    const live = await this.restore(projectId, chatId);
    const item = live.timeline.state.items.find(
      (i): i is ProposalItem => i.kind === 'proposal' && i.id === itemId,
    );
    if (!item) throw new Error('The proposal is no longer in the chat');
    const context = this.project(projectId);
    let next: ProposalItem;
    let note: string;
    try {
      if (action.action === 'reject') {
        if (item.state !== 'pending') throw new Error('The proposal is already decided');
        if (item.proposal.type === 'import') {
          const record = this.importRecord(chatId);
          if (record) await removeImport(record.dir);
        }
        next = { ...item, state: 'rejected' };
        note = `The user rejected ${describe(item.proposal)}.`;
      } else if (action.action === 'revert') {
        if (item.state !== 'applied' || item.proposal.type !== 'doc') {
          throw new Error('Only an applied document can be rolled back');
        }
        await this.revertDoc(context, item.proposal);
        next = { ...item, state: 'reverted' };
        note = `The user rolled back .skaro/${item.proposal.path} to its previous text.`;
      } else {
        if (item.state !== 'pending') throw new Error('The proposal is already decided');
        const applied = await this.apply(live, context, item.proposal, action);
        next = { ...item, state: 'applied', ...(applied.result ? { result: applied.result } : {}) };
        note = applied.note;
      }
    } finally {
      context.invalidate();
    }
    this.skaroEvent(live, { t: 'item.upsert', item: next });
    this.addNotes(chatId, [note]);
    this.deps.emit('project.changed', { projectId });
  }

  private async apply(
    live: LiveChat,
    context: ProjectContext,
    proposal: Proposal,
    action: Extract<ProposalAction, { action: 'apply' }>,
  ): Promise<{ result?: ProposalResult; note: string }> {
    const { store } = context;
    switch (proposal.type) {
      case 'doc': {
        const current = await currentDoc(context, proposal.path);
        if (!sameText(current, proposal.before)) {
          throw new Error(
            `.skaro/${proposal.path} changed after the proposal; ask the agent again`,
          );
        }
        await store.writeDoc(proposal.path, proposal.after);
        this.deps.db.addEvent(live.projectId, 'doc_updated', { path: proposal.path });
        return { note: `The user accepted the change to .skaro/${proposal.path}.` };
      }
      case 'adr': {
        const title = action.adr?.title.trim() || proposal.title;
        const body = action.adr?.body ?? proposal.body;
        const adr = await store.createAdr({
          title,
          body,
          status: 'accepted',
          ...(proposal.replaces ? { replaces: proposal.replaces } : {}),
        });
        this.deps.db.addEvent(live.projectId, 'adr_accepted', { id: adr.id, title: adr.title });
        const edited =
          action.adr !== undefined && (title !== proposal.title || body !== proposal.body);
        return {
          result: { adr: { id: adr.id, title: adr.title } },
          note:
            `The user accepted ADR-${adr.id} "${adr.title}"` +
            (edited ? ' after editing it (read it in .skaro/adr/).' : '.'),
        };
      }
      case 'spec': {
        const title = action.adr?.title.trim() || proposal.title;
        const body = action.adr?.body ?? proposal.body;
        const spec = await store.createSpec({
          title,
          body,
          status: 'accepted',
          ...(proposal.replaces ? { replaces: proposal.replaces } : {}),
        });
        this.deps.db.addEvent(live.projectId, 'spec_accepted', { id: spec.id, title: spec.title });
        const edited =
          action.adr !== undefined && (title !== proposal.title || body !== proposal.body);
        return {
          result: { spec: { id: spec.id, title: spec.title } },
          note:
            `The user accepted SPEC-${spec.id} "${spec.title}"` +
            (edited ? ' after editing it (read it in .skaro/specs/).' : '.'),
        };
      }
      case 'spec_change': {
        const current = (await context.load()).specs.find((s) => s.id === proposal.id);
        if (!current) throw new Error(`SPEC-${proposal.id} no longer exists`);
        if (!sameText(current.body, proposal.before)) {
          throw new Error(`SPEC-${proposal.id} changed after the proposal; ask the agent again`);
        }
        await store.writeSpec(proposal.id, proposal.after);
        this.deps.db.addEvent(live.projectId, 'spec_updated', { id: proposal.id });
        return {
          result: { spec: { id: proposal.id, title: proposal.title } },
          note: `The user accepted the change to SPEC-${proposal.id} "${proposal.title}".`,
        };
      }
      case 'import':
        return this.applyImportProposal(live, context, action.import);
      case 'plan':
        return this.applyPlan(live, context, proposal, action.tasks);
      case 'task': {
        await store.readTask(proposal.id);
        await store.updateTask(proposal.id, proposal.patch);
        this.deps.db.addEvent(live.projectId, 'task_changed', { task: proposal.id });
        return { note: `The user accepted the change to ${proposal.id} "${proposal.title}".` };
      }
    }
  }

  private async applyPlan(
    live: LiveChat,
    context: ProjectContext,
    proposal: PlanProposal,
    picked: string[] | undefined,
  ): Promise<{ result: ProposalResult; note: string }> {
    const chosen = proposal.tasks.filter((t) => !picked || picked.includes(t.ref));
    if (!chosen.length) throw new Error('No tasks are selected');
    const { store } = context;
    const artifacts = await context.load();
    const result: ProposalResult = {};
    let milestone =
      proposal.milestone && !proposal.milestone.isNew ? proposal.milestone.id : undefined;
    if (milestone && !artifacts.milestones.some((m) => m.id === milestone)) {
      throw new Error(`Milestone ${milestone} no longer exists`);
    }
    if (proposal.milestone?.isNew) {
      const created = await store.createMilestone({
        title: proposal.milestone.title,
        ...(proposal.milestone.body ? { body: proposal.milestone.body } : {}),
      });
      milestone = created.id;
      result.milestone = { id: created.id, title: created.title };
    }

    // Refs of tasks earlier cards of this chat created, then the ones created now.
    const known = new Map<string, string>();
    for (const item of live.timeline.state.items) {
      if (item.kind === 'proposal')
        for (const t of item.result?.tasks ?? []) known.set(t.ref, t.id);
    }
    const existing = new Set(artifacts.tasks.map((t) => t.id));
    const specs = new Set(artifacts.specs.map((s) => s.id));
    let order =
      Math.max(
        0,
        ...artifacts.tasks.filter((t) => t.milestone === milestone).map((t) => t.order ?? 0),
      ) + 1;
    const created: { id: string; title: string; ref: string }[] = [];
    for (const task of chosen) {
      const t = await store.createTask({
        title: task.title,
        body: task.body,
        order: order++,
        ...(milestone ? { milestone } : {}),
        ...(task.spec && specs.has(task.spec) ? { spec: task.spec } : {}),
      });
      known.set(task.ref, t.id);
      created.push({ id: t.id, title: t.title, ref: task.ref });
    }
    const dropped: string[] = [];
    for (const [i, task] of chosen.entries()) {
      const ids: string[] = [];
      task.dependsOn.forEach((dep, d) => {
        const id = known.get(dep) ?? (existing.has(dep) ? dep : undefined);
        if (id) ids.push(id);
        else dropped.push(`"${task.title}" → "${task.dependsOnTitles[d] ?? dep}"`);
      });
      if (ids.length) await store.updateTask(created[i]!.id, { dependsOn: ids });
    }
    result.tasks = created;
    this.deps.db.addEvent(live.projectId, 'tasks_created', {
      count: created.length,
      ...(milestone ? { milestone } : {}),
    });

    const skipped = proposal.tasks.filter((t) => !chosen.includes(t));
    const note = [
      result.milestone
        ? `The user created milestone ${result.milestone.id} "${result.milestone.title}" with tasks:`
        : `The user created tasks${milestone ? ` in ${milestone}` : ''}:`,
      created.map((t) => `${t.id} "${t.title}"`).join(', ') + '.',
      skipped.length ? `Not taken: ${skipped.map((t) => `"${t.title}"`).join(', ')}.` : '',
      dropped.length
        ? `Dependencies left out because the task was not created: ${dropped.join(', ')}.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    return { result, note };
  }

  private async revertDoc(
    context: ProjectContext,
    proposal: Extract<Proposal, { type: 'doc' }>,
  ): Promise<void> {
    const current = await currentDoc(context, proposal.path);
    if (!sameText(current, proposal.after)) {
      throw new Error(`.skaro/${proposal.path} changed after it was applied`);
    }
    if (proposal.before === undefined) await context.store.deleteDoc(proposal.path);
    else await context.store.writeDoc(proposal.path, proposal.before);
  }

  // ── import of documentation (architecture.md 12) ─────────────────────────

  /** What the import modal says about the picked sources. */
  scanImport(paths: string[]): Promise<ImportSource[]> {
    return Promise.all(paths.map((p) => scanSource(p)));
  }

  /** Creates the import chat at once; copying the sources and the agent go on in the background. */
  async startImport(
    projectId: string,
    paths: string[],
    settings: ChatSettings,
  ): Promise<ChatSummary> {
    this.project(projectId);
    await this.ensureAgent(settings.agent);
    const sources = await this.scanImport(paths);
    const missing = sources.find((s) => s.missing);
    if (missing) throw new Error(`${missing.display} is not available`);
    if (!sources.some((s) => s.readable > 0)) throw new Error('Nothing to import');
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const dir = join(this.deps.dataDir, 'imports', projectId, id);
    const chat = this.deps.db.createChat({
      projectId,
      agent: settings.agent,
      title: this.importText().title,
      logPath: join('chats', projectId, `${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`),
    });
    this.deps.db.setSetting(settingsKey(chat.id), saved(settings));
    this.deps.db.setSetting(importKey(chat.id), { id, dir });
    const state: ImportState = { id, dir, sources, staged: [] };
    await saveState(state);
    const live = new LiveChat(projectId, chat, new Timeline());
    this.live.set(chat.id, live);
    this.listChanged(projectId, chat.id);
    void this.runImport(live, state).catch((error: unknown) => this.failTurn(live, error));
    return this.summary(chat);
  }

  /** The copy of the sources, then the first message with them, then the "prepared" line. */
  private async runImport(live: LiveChat, state: ImportState): Promise<void> {
    const manifest = await snapshot(state.sources, state.dir);
    const words = this.importText();
    const text = [
      words.title,
      ...state.sources.map((s) => `${s.display} · ${words.files(s.files)}`),
    ].join('\n');
    const before = live.timeline.state.items.length;
    await this.deliver(live, { text });
    // The line goes under the user's message: wait for the agent to echo it.
    for (let i = 0; i < 100; i++) {
      if (
        live.timeline.state.items
          .slice(before)
          .some((it) => it.kind === 'message' && it.role === 'user')
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    this.skaroEvent(live, {
      t: 'item.upsert',
      item: {
        id: `skaro-import-prep-${state.id}`,
        turnId: currentTurn(live),
        kind: 'import_prep',
        prepared: manifest.files.filter((f) => f.action !== 'skipped').length,
        skipped: manifest.files.filter((f) => f.action === 'skipped').length,
        files: prepFiles(manifest, words),
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'import_prep', ref: state.id },
      },
    });
  }

  async stageArtifact(args: StageArtifactArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.caller(scope);
    const state = await this.importOf(live.chat.id);
    const artifacts = await this.project(live.projectId).load();
    const locale = this.deps.locale();
    const words = this.importText();
    let staged: StagedArtifact;
    const base = {
      key: args.key,
      type: args.type,
      sources: args.sources,
      ...(args.status ? { status: args.status } : {}),
    };
    switch (args.type) {
      case 'brief':
      case 'architecture': {
        const exists =
          (args.type === 'brief' ? artifacts.brief : artifacts.architecture) !== undefined;
        staged = {
          ...base,
          title: args.type === 'brief' ? words.brief : words.architecture,
          body: args.body ?? '',
          ...(exists ? { updates: `${args.type}.md` } : {}),
        };
        break;
      }
      case 'doc': {
        const name = docName({
          ...base,
          title: args.name ?? args.updates ?? args.title ?? '',
          body: '',
        });
        const exists = artifacts.docs.some((d) => d.path === `.skaro/docs/${name}`);
        staged = {
          ...base,
          title: name,
          name,
          body: args.body ?? '',
          ...(exists ? { updates: name } : {}),
        };
        break;
      }
      case 'adr':
      case 'spec': {
        let updates: string | undefined;
        if (args.updates) {
          updates = adrId(args.updates);
          const list = args.type === 'adr' ? artifacts.adrs : artifacts.specs;
          if (!list.some((x) => x.id === updates)) {
            return {
              text: `There is no ${args.type === 'adr' ? 'ADR' : 'specification'} ${args.updates} to update.`,
              isError: true,
            };
          }
        }
        staged = {
          ...base,
          title: args.title ?? '',
          body: args.body ?? '',
          ...(updates ? { updates } : {}),
        };
        break;
      }
      case 'milestone':
        staged = {
          ...base,
          title: args.title ?? '',
          body: milestoneBody(
            { title: args.title ?? '', goal: args.goal ?? '', criteria: args.doneWhen ?? '' },
            locale,
          ),
        };
        break;
      case 'task':
        staged = {
          ...base,
          title: args.title ?? '',
          body: taskBody(
            {
              goal: args.goal ?? '',
              criteria: args.criteria ?? [],
              ...(args.notes ? { notes: args.notes } : {}),
            },
            locale,
          ),
          ...(args.milestone ? { milestone: args.milestone } : {}),
          ...(args.dependsOn?.length ? { dependsOn: args.dependsOn } : {}),
          ...(args.spec ? { spec: args.spec } : {}),
        };
        break;
    }
    const before = currentText(artifacts, staged);
    if (staged.updates && before !== undefined) staged.before = before;
    const replaced = state.staged.some((s) => s.key === args.key);
    state.staged = [...state.staged.filter((s) => s.key !== args.key), staged];
    await saveState(state);
    return {
      text:
        `${replaced ? 'Replaced' : 'Staged'} ${args.type} "${staged.title}" as ${args.key}` +
        `${staged.updates ? ` (changes ${staged.updates})` : ''}. ${state.staged.length} staged.`,
    };
  }

  async finishImport(args: FinishImportArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.caller(scope);
    const state = await this.importOf(live.chat.id);
    if (!state.staged.length) {
      return { text: 'Nothing is staged yet; stage the artifacts first.', isError: true };
    }
    const artifacts = await this.project(live.projectId).load();
    const problems = importLinks(state.staged, artifacts);
    if (problems.length) return { text: problems.join('\n'), isError: true };
    const manifest = await loadManifest(state.dir);
    const skipped = [
      ...(manifest?.files ?? [])
        .filter((f) => f.action === 'skipped')
        .map((f) => ({ path: f.source, reason: f.reason ?? '' })),
      ...args.skipped,
    ];
    state.report = { skipped, notes: args.notes };
    await saveState(state);
    this.skaroEvent(live, {
      t: 'item.upsert',
      item: {
        id: `skaro-import-${state.id}`,
        turnId: currentTurn(live),
        kind: 'proposal',
        proposal: {
          type: 'import',
          id: state.id,
          groups: importGroups(state.staged),
          total: state.staged.length,
          skipped: skipped.length,
          notes: args.notes.length,
        },
        state: 'pending',
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'proposal', ref: 'import' },
      },
    });
    return {
      text:
        `The import is shown to the user as the "Import is ready" card with ${state.staged.length} ` +
        'artifacts; the user reviews and applies what they pick. The decision comes with their ' +
        'next message. Tell the user in one or two sentences what you carried over.',
    };
  }

  /** What the import agent staged, for the review screen. */
  async importReview(projectId: string, chatId: string): Promise<ImportReview> {
    await this.restore(projectId, chatId);
    const state = await this.importOf(chatId);
    const keys = new Set(state.staged.map((s) => s.key));
    const artifacts = await this.project(projectId).load();
    let next =
      Math.max(0, ...artifacts.milestones.map((m) => Number(/^M(\d+)$/.exec(m.id)?.[1] ?? 0))) + 1;
    const milestones: Record<string, string> = {};
    for (const s of state.staged.filter((x) => x.type === 'milestone')) {
      milestones[s.key] = `M${String(next++).padStart(2, '0')}`;
    }
    return {
      milestones,
      items: state.staged.map((s) => ({
        key: s.key,
        type: s.type,
        title: s.title,
        update: !!s.updates,
        sources: s.sources,
        body: s.body,
        ...(s.before !== undefined ? { before: s.before } : {}),
        ...(s.milestone ? { milestone: s.milestone } : {}),
        dependsOn: s.dependsOn ?? [],
        ...(s.spec ? { spec: s.spec } : {}),
        ...(s.type === 'task' || s.type === 'milestone' ? { fields: fieldsOf(s) } : {}),
        refs: [
          ...new Set(
            [
              ...[...s.body.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]!),
              s.milestone ?? '',
              s.spec ?? '',
              ...(s.dependsOn ?? []),
            ].filter((k) => keys.has(k) && k !== s.key),
          ),
        ],
      })),
      skipped: state.report?.skipped ?? [],
      notes: state.report?.notes ?? [],
    };
  }

  private async applyImportProposal(
    live: LiveChat,
    context: ProjectContext,
    picked: string[] | undefined,
  ): Promise<{ result: ProposalResult; note: string }> {
    const state = await this.importOf(live.chat.id);
    const keys = picked ?? state.staged.map((s) => s.key);
    if (!keys.length) throw new Error('Nothing is selected');
    let applied;
    try {
      applied = await applyImport(
        context.store,
        await context.load(),
        state.staged,
        keys,
        (done, total) =>
          this.deps.emit('import.progress', {
            projectId: live.projectId,
            chatId: live.chat.id,
            done,
            total,
          }),
      );
    } catch (error) {
      if (error instanceof ChangedOnDisk)
        throw new Error(`changed-on-disk:${error.path}`, { cause: error });
      throw error;
    }
    this.deps.db.addEvent(live.projectId, 'import_applied', {
      count: keys.length,
      total: state.staged.length,
    });
    await removeImport(state.dir);
    const skipped = state.staged.filter((s) => !keys.includes(s.key));
    const note = [
      `The user imported ${keys.length} of ${state.staged.length}: ` +
        applied.imported
          .map((i) => (i.code ? `${i.code} "${i.title}"` : `"${i.title}"`))
          .join(', ') +
        '.',
      skipped.length ? `Not taken: ${skipped.map((s) => `"${s.title}"`).join(', ')}.` : '',
      applied.dropped.length ? `Links left out: ${applied.dropped.join('; ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return { result: { imported: applied.imported, applied: keys.length }, note };
  }

  /** "Открыть исходный файл": the source on disk; a file inside an archive opens the archive. */
  async openImportSource(projectId: string, chatId: string, source: string): Promise<string> {
    await this.restore(projectId, chatId);
    const state = await this.importOf(chatId);
    const manifest = await loadManifest(state.dir);
    const file = manifest?.files.find((f) => f.source === source);
    if (file?.origin) return file.origin;
    const root = manifest?.sources.find(
      (s) => source === s.display || source.startsWith(`${s.display}/`),
    );
    if (!root) throw new Error(`unknown source ${source}`);
    return root.path;
  }

  private importRecord(chatId: string): { id: string; dir: string } | undefined {
    return (
      this.deps.db.getSetting<{ id: string; dir: string } | null>(importKey(chatId), null) ??
      undefined
    );
  }

  private async importOf(chatId: string): Promise<ImportState> {
    const record = this.importRecord(chatId);
    const state = record ? await loadState(record.dir) : undefined;
    if (!state) throw new Error('The import is no longer available');
    return state;
  }

  private importText(): ImportWords {
    return this.deps.locale() === 'ru' ? IMPORT_RU : IMPORT_EN;
  }

  // ── MCP tools of the chat agent ──────────────────────────────────────────

  async context(scope: SkaroScope): Promise<ToolResult> {
    const context = this.project(scope.projectId);
    const artifacts = await context.load();
    const name = this.deps.db.getProject(scope.projectId)?.name ?? '';
    return {
      text: projectContextText(name, artifacts, this.deps.db.getTaskRuntime(scope.projectId)),
    };
  }

  async writeDoc(args: WriteDocArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.caller(scope);
    if (!DOC_PATH.test(args.path)) {
      return {
        text: 'path must be brief.md, architecture.md or docs/<name>.md inside .skaro/.',
        isError: true,
      };
    }
    const context = this.project(live.projectId);
    const artifacts = await context.load();
    const before = await currentDoc(context, args.path);
    const after = `${args.content.replace(/\s+$/, '')}\n`;
    if (sameText(before, after)) {
      return { text: `.skaro/${args.path} already has this text; nothing changed.` };
    }
    const auto = artifacts.config.chat.autoAcceptDocs;
    if (auto) {
      await context.store.writeDoc(args.path, after);
      this.deps.db.addEvent(live.projectId, 'doc_updated', { path: args.path });
      context.invalidate();
      this.deps.emit('project.changed', { projectId: live.projectId });
    }
    this.addProposal(
      live,
      {
        type: 'doc',
        path: args.path,
        ...(before !== undefined ? { before } : {}),
        after,
        ...(args.summary ? { summary: args.summary } : {}),
      },
      auto ? 'applied' : 'pending',
    );
    return {
      text: auto
        ? `Skaro wrote .skaro/${args.path} (documents from the chat apply at once in this ` +
          'project). The user sees the change as a card and can roll it back.'
        : `The change to .skaro/${args.path} is shown to the user as a card and is applied only ` +
          'if the user accepts it. The decision comes with their next message; continue.',
    };
  }

  async proposeAdr(args: ProposeAdrArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.caller(scope);
    const artifacts = await this.project(live.projectId).load();
    let replaces: string | undefined;
    if (args.replaces) {
      replaces = adrId(args.replaces);
      if (!artifacts.adrs.some((a) => a.id === replaces)) {
        return { text: `There is no ADR ${args.replaces} to replace.`, isError: true };
      }
    }
    const pending = this.proposals(live).filter((p) => p.proposal.type === 'adr').length;
    const id = String(
      nextNumber(
        artifacts.adrs.map((a) => a.id),
        /^(\d+)$/,
      ) + pending,
    ).padStart(4, '0');
    const h = headings(this.deps.locale());
    const body =
      `## ${h.context}\n\n${args.context}\n\n## ${h.decision}\n\n${args.decision}\n\n` +
      `## ${h.consequences}\n\n${args.consequences}\n`;
    this.addProposal(
      live,
      {
        type: 'adr',
        id,
        title: args.title,
        body,
        ...(replaces ? { replaces } : {}),
        ...(args.summary ? { summary: args.summary } : {}),
      },
      'pending',
    );
    return {
      text:
        `ADR "${args.title}" is shown to the user as a card (it becomes ADR-${id} if accepted ` +
        'now). The decision comes with their next message; continue.',
    };
  }

  async proposeSpec(args: ProposeSpecArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.caller(scope);
    const context = this.project(live.projectId);
    const artifacts = await context.load();
    const content = `${args.content.replace(/\s+$/, '')}\n`;
    if (args.id) {
      const id = adrId(args.id);
      const spec = artifacts.specs.find((s) => s.id === id);
      if (!spec) return { text: `There is no specification ${args.id}.`, isError: true };
      if (sameText(spec.body, content)) {
        return { text: `SPEC-${id} already has this text; nothing changed.` };
      }
      const auto = artifacts.config.chat.autoAcceptDocs;
      if (auto) {
        await context.store.writeSpec(id, content);
        this.deps.db.addEvent(live.projectId, 'spec_updated', { id });
        context.invalidate();
        this.deps.emit('project.changed', { projectId: live.projectId });
      }
      this.addProposal(
        live,
        {
          type: 'spec_change',
          id,
          title: spec.title,
          before: spec.body,
          after: content,
          ...(args.summary ? { summary: args.summary } : {}),
        },
        auto ? 'applied' : 'pending',
      );
      return {
        text: auto
          ? `Skaro updated SPEC-${id} (documents from the chat apply at once in this project).`
          : `The change to SPEC-${id} is shown to the user as a card and is applied only if the ` +
            'user accepts it. The decision comes with their next message; continue.',
      };
    }
    let replaces: string | undefined;
    if (args.replaces) {
      replaces = adrId(args.replaces);
      if (!artifacts.specs.some((s) => s.id === replaces)) {
        return { text: `There is no specification ${args.replaces} to replace.`, isError: true };
      }
    }
    const pending = this.proposals(live).filter((p) => p.proposal.type === 'spec').length;
    const id = String(
      nextNumber(
        artifacts.specs.map((s) => s.id),
        /^(\d+)$/,
      ) + pending,
    ).padStart(4, '0');
    const title = args.title ?? '';
    this.addProposal(
      live,
      {
        type: 'spec',
        id,
        title,
        body: content,
        ...(replaces ? { replaces } : {}),
        ...(args.summary ? { summary: args.summary } : {}),
      },
      'pending',
    );
    return {
      text:
        `Specification "${title}" is shown to the user as a card (it becomes SPEC-${id} if ` +
        'accepted now). The decision comes with their next message; continue. Cut its tasks ' +
        'after it is accepted and link them with "spec".',
    };
  }

  async proposeMilestones(args: ProposeMilestonesArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.caller(scope);
    const artifacts = await this.project(live.projectId).load();
    const all = args.milestones.flatMap((m) => m.tasks);
    const problem = this.checkTasks(live, artifacts, all);
    if (problem) return { text: problem, isError: true };
    const titles = this.titlesByRef(live, artifacts, all);
    const pending = this.proposals(live).filter(
      (p) => p.proposal.type === 'plan' && p.proposal.milestone?.isNew,
    ).length;
    const first =
      nextNumber(
        artifacts.milestones.map((m) => m.id),
        /^M(\d+)$/,
      ) + pending;
    const h = headings(this.deps.locale());
    const shown = args.milestones.map((m, i) => {
      const id = `M${String(first + i).padStart(2, '0')}`;
      this.addProposal(
        live,
        {
          type: 'plan',
          milestone: {
            id,
            title: m.title,
            body: `## ${h.goal}\n\n${m.goal}\n\n## ${h.done}\n\n${m.doneWhen}\n`,
            isNew: true,
          },
          tasks: m.tasks.map((t) => this.proposedTask(t, titles)),
        },
        'pending',
      );
      return `${id} "${m.title}" (${m.tasks.length} tasks)`;
    });
    return {
      text:
        `Shown to the user as cards: ${shown.join(', ')}. Only the tasks the user picks are ` +
        'created; the decision comes with their next message. Continue.',
    };
  }

  async proposeTasks(args: ProposeTasksArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.caller(scope);
    const artifacts = await this.project(live.projectId).load();
    const milestone = args.milestone
      ? artifacts.milestones.find((m) => m.id.toUpperCase() === args.milestone!.toUpperCase())
      : undefined;
    if (args.milestone && !milestone) {
      return { text: `There is no milestone ${args.milestone}.`, isError: true };
    }
    const problem = this.checkTasks(live, artifacts, args.tasks);
    if (problem) return { text: problem, isError: true };
    const titles = this.titlesByRef(live, artifacts, args.tasks);
    this.addProposal(
      live,
      {
        type: 'plan',
        ...(milestone
          ? { milestone: { id: milestone.id, title: milestone.title, isNew: false } }
          : {}),
        tasks: args.tasks.map((t) => this.proposedTask(t, titles)),
      },
      'pending',
    );
    return {
      text:
        `${args.tasks.length} tasks are shown to the user as a card; only the ones the user ` +
        'picks are created. The decision comes with their next message. Continue.',
    };
  }

  async updateTask(args: UpdateTaskArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.caller(scope);
    const artifacts = await this.project(live.projectId).load();
    const task = artifacts.tasks.find((t) => t.id.toUpperCase() === args.id.toUpperCase());
    if (!task) return { text: `There is no task ${args.id}.`, isError: true };
    const ids = new Set(artifacts.tasks.map((t) => t.id));
    const deps = args.dependsOn?.map((d) => d.toUpperCase());
    const unknown = deps?.filter((d) => !ids.has(d) || d === task.id) ?? [];
    if (unknown.length) {
      return {
        text: `depends_on must list other existing tasks; not valid: ${unknown.join(', ')}.`,
        isError: true,
      };
    }
    const milestone = args.milestone
      ? artifacts.milestones.find((m) => m.id.toUpperCase() === args.milestone!.toUpperCase())
      : undefined;
    if (args.milestone && !milestone) {
      return { text: `There is no milestone ${args.milestone}.`, isError: true };
    }
    const body =
      args.goal !== undefined || args.criteria !== undefined || args.notes !== undefined
        ? withSections(
            task.body,
            {
              ...(args.goal !== undefined ? { goal: args.goal } : {}),
              ...(args.criteria !== undefined ? { criteria: args.criteria } : {}),
              ...(args.notes !== undefined ? { notes: args.notes } : {}),
            },
            this.deps.locale(),
          )
        : undefined;
    const patch = {
      ...(args.title && args.title !== task.title ? { title: args.title } : {}),
      ...(body !== undefined && body !== task.body ? { body } : {}),
      ...(deps && deps.join() !== task.dependsOn.join() ? { dependsOn: deps } : {}),
      ...(milestone && milestone.id !== task.milestone ? { milestone: milestone.id } : {}),
    };
    if (!Object.keys(patch).length) return { text: `${task.id} already looks like this.` };
    const after: Task = { ...task, ...patch };
    this.addProposal(
      live,
      {
        type: 'task',
        id: task.id,
        title: after.title,
        before: taskText(task),
        after: taskText(after),
        patch,
      },
      'pending',
    );
    return {
      text:
        `The change to ${task.id} is shown to the user as a card. The decision comes with their ` +
        'next message; continue.',
    };
  }

  /** The chat whose agent is calling; its grant must be the live one. */
  private caller(scope: SkaroScope): LiveChat {
    const live = scope.chatId ? this.live.get(scope.chatId) : undefined;
    if (!live || live.projectId !== scope.projectId || !live.session) {
      throw new Error('This chat session is no longer active.');
    }
    return live;
  }

  private proposals(live: LiveChat): ProposalItem[] {
    return live.timeline.state.items.filter((i): i is ProposalItem => i.kind === 'proposal');
  }

  /** Refs tasks of this chat may depend on: this call, earlier cards, existing tasks. */
  private checkTasks(
    live: LiveChat,
    artifacts: ProjectArtifacts,
    tasks: ProposedTaskArgs[],
  ): string | undefined {
    const earlier = new Set(
      this.proposals(live).flatMap((p) =>
        p.proposal.type === 'plan' ? p.proposal.tasks.map((t) => t.ref) : [],
      ),
    );
    const refs = new Set(tasks.map((t) => t.ref));
    const clash = [...refs].filter((r) => earlier.has(r));
    if (clash.length) {
      return `Refs ${clash.join(', ')} are already used by earlier cards in this chat; use new refs.`;
    }
    const ids = new Set(artifacts.tasks.map((t) => t.id));
    const unknown = tasks.flatMap((t) =>
      t.dependsOn.filter((d) => !refs.has(d) && !earlier.has(d) && !ids.has(d.toUpperCase())),
    );
    if (unknown.length) {
      return (
        `Unknown dependencies: ${[...new Set(unknown)].join(', ')}. Use refs of tasks in this ` +
        'call or of earlier cards, or ids of existing tasks.'
      );
    }
    const specs = new Set(artifacts.specs.map((s) => s.id));
    const noSpec = tasks.filter((t) => t.spec && !specs.has(adrId(t.spec)));
    if (noSpec.length) {
      return (
        `Unknown specifications: ${[...new Set(noSpec.map((t) => t.spec))].join(', ')}. ` +
        'Link tasks only to accepted specifications (get_project_context lists them).'
      );
    }
    const self = tasks.filter((t) => t.dependsOn.includes(t.ref));
    if (self.length) return `A task cannot depend on itself: ${self.map((t) => t.ref).join(', ')}.`;
    const cycle = findCycle(tasks);
    if (cycle) return `Dependencies form a cycle: ${cycle.join(' → ')}.`;
    return undefined;
  }

  private titlesByRef(
    live: LiveChat,
    artifacts: ProjectArtifacts,
    tasks: ProposedTaskArgs[],
  ): Map<string, string> {
    const titles = new Map<string, string>();
    for (const t of artifacts.tasks) titles.set(t.id, t.title);
    for (const p of this.proposals(live)) {
      if (p.proposal.type === 'plan') for (const t of p.proposal.tasks) titles.set(t.ref, t.title);
    }
    for (const t of tasks) titles.set(t.ref, t.title);
    return titles;
  }

  private proposedTask(task: ProposedTaskArgs, titles: Map<string, string>): ProposedTask {
    const dependsOn = task.dependsOn.map((d) => (titles.has(d) ? d : d.toUpperCase()));
    return {
      ref: task.ref,
      title: task.title,
      body: taskBody(
        {
          goal: task.goal,
          criteria: task.criteria,
          ...(task.notes ? { notes: task.notes } : {}),
        },
        this.deps.locale(),
      ),
      dependsOn,
      dependsOnTitles: dependsOn.map((d) => titles.get(d) ?? d),
      ...(task.spec ? { spec: adrId(task.spec) } : {}),
    };
  }

  private addProposal(live: LiveChat, proposal: Proposal, state: ProposalItem['state']): void {
    this.skaroEvent(live, {
      t: 'item.upsert',
      item: {
        id: `skaro-proposal-${randomUUID()}`,
        turnId: currentTurn(live),
        kind: 'proposal',
        proposal,
        state,
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'proposal', ref: proposal.type },
      },
    });
  }

  // ── decisions for the agent ──────────────────────────────────────────────

  private takeNotes(chatId: string): string[] {
    const notes = this.deps.db.getSetting<string[] | null>(notesKey(chatId), null) ?? [];
    if (notes.length) this.deps.db.setSetting(notesKey(chatId), []);
    return notes;
  }

  private addNotes(chatId: string, notes: string[]): void {
    if (!notes.length) return;
    const current = this.deps.db.getSetting<string[] | null>(notesKey(chatId), null) ?? [];
    this.deps.db.setSetting(notesKey(chatId), [...current, ...notes]);
  }

  // ── sessions ─────────────────────────────────────────────────────────────

  private attach(live: LiveChat): Promise<AgentSession> {
    if (live.session) return Promise.resolve(live.session);
    live.attaching ??= this.startSession(live).finally(() => (live.attaching = undefined));
    return live.attaching;
  }

  private async startSession(live: LiveChat): Promise<AgentSession> {
    const { projectId, chat } = live;
    const context = this.project(projectId);
    const artifacts = await context.load();
    const agent = chat.agent as AgentId;
    await this.ensureAgent(agent);
    const settings = await this.withDefaults(agent, context.root, this.settings(chat));
    // Codex runs its sandbox in the mode the self-check chose (D-28).
    const sandbox =
      agent === 'codex' ? await this.deps.agents.sandbox(agent).catch(() => undefined) : undefined;
    const adapter = this.deps.agents.adapter(agent);
    const resume = chat.nativeSessionId;

    const segment = live.segments++;
    this.writeLine(live, {
      ts: Date.now() - chat.createdAt,
      dir: 'meta',
      line: { skaro: 'segment', agent, adapterVersion: adapter.adapterVersion },
    });
    const imported = this.importRecord(chat.id);
    live.grant = this.deps.mcp.grant({
      kind: 'project_chat',
      projectId,
      chatId: chat.id,
      ...(imported ? { importId: imported.id } : {}),
    });
    const instructions = imported
      ? importInstructions({
          projectName: this.deps.db.getProject(projectId)?.name ?? '',
          root: context.root,
          artifacts,
          locale: this.deps.locale(),
          dir: imported.dir,
          hasCode: await hasCode(context.root),
        })
      : chatInstructions({
          projectName: this.deps.db.getProject(projectId)?.name ?? '',
          root: context.root,
          artifacts,
          locale: this.deps.locale(),
        });
    let session: AgentSession;
    try {
      session = await adapter.start({
        cwd: context.root,
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.effort ? { effort: settings.effort } : {}),
        permissionMode: settings.permissionMode ?? 'ask',
        planFirst: false,
        instructions,
        ...(imported ? { readDirs: [imported.dir] } : {}),
        mcpServers: {
          skaro: {
            type: 'http',
            url: live.grant.url,
            headers: live.grant.headers,
            trusted: true,
          },
        },
        ...(sandbox ? { sandboxVerified: sandbox.holds } : {}),
        ...(sandbox?.mode ? { sandboxMode: sandbox.mode } : {}),
        ...(resume ? { resume } : {}),
        raw: (line) => this.writeLine(live, { ...line, ts: Date.now() - chat.createdAt }),
        context: this.deps.attachments.context(),
      });
    } catch (error) {
      live.grant.revoke();
      live.grant = undefined;
      if (resume) this.notice(live, 'session_lost', 'error', errorText(error));
      throw error;
    }
    live.session = session;
    if (resume) this.notice(live, 'session_restored', 'info', '');
    void this.pump(live, session, segment);
    return session;
  }

  private async pump(live: LiveChat, session: AgentSession, segment: number): Promise<void> {
    try {
      for await (const event of session.events) {
        this.onEvent(live, segmentTurns(segment, event));
      }
    } catch (error) {
      this.failTurn(live, error);
    }
    if (live.session === session) {
      live.session = undefined;
      live.grant?.revoke();
      live.grant = undefined;
      const turn = live.timeline.state.turns.at(-1);
      if (turn && !turn.outcome) this.failTurn(live, new Error('The agent process exited'));
      this.listChanged(live.projectId, live.chat.id);
    }
  }

  private onEvent(live: LiveChat, event: TimelineEvent): void {
    live.timeline.apply(event);
    live.seq++;
    live.pending.push(event);
    live.flushTimer ??= setTimeout(() => this.flush(live), FLUSH_MS);
    switch (event.t) {
      case 'session.started':
        if (event.nativeSessionId && event.nativeSessionId !== live.chat.nativeSessionId) {
          this.deps.db.updateChat(live.chat.id, { nativeSessionId: event.nativeSessionId });
          live.chat = this.deps.db.getChat(live.chat.id) ?? live.chat;
        }
        return;
      case 'turn.started':
      case 'turn.completed':
        this.listChanged(live.projectId, live.chat.id);
        return;
    }
  }

  private failTurn(live: LiveChat, error: unknown): void {
    const turn = live.timeline.state.turns.at(-1);
    if (turn && !turn.outcome) {
      for (const i of live.timeline.state.interactions) {
        this.skaroEvent(live, { t: 'interaction.closed', id: i.id, resolution: 'expired' });
      }
      this.skaroEvent(live, {
        t: 'turn.completed',
        turnId: turn.id,
        outcome: 'failed',
        error: { category: 'other', message: errorText(error) },
      });
    } else {
      this.notice(live, 'other', 'error', errorText(error));
    }
  }

  /** A chat from AppDb, rebuilt from its raw log (principle P2). */
  private async restore(projectId: string, chatId: string): Promise<LiveChat> {
    const existing = this.live.get(chatId);
    if (existing) return existing;
    const chat = this.deps.db.getChat(chatId);
    if (!chat || chat.projectId !== projectId) throw new Error('The chat is not found');
    const lines = await readRunLog(join(this.deps.dataDir, chat.logPath));
    const again = this.live.get(chatId);
    if (again) return again;
    const events = replayRunLog(lines, chat.createdAt, projectorFor(chat.agent), (image) =>
      this.deps.attachments.save(image),
    );
    const live = new LiveChat(projectId, chat, Timeline.from(events));
    live.seq = events.length;
    live.segments = countSegments(lines);
    this.live.set(chatId, live);
    // Nothing survives a restart: an open turn ends as interrupted, its questions expire.
    const turn = live.timeline.state.turns.at(-1);
    if (turn && !turn.outcome) {
      for (const i of live.timeline.state.interactions) {
        this.skaroEvent(live, { t: 'interaction.closed', id: i.id, resolution: 'expired' });
      }
      this.skaroEvent(live, { t: 'turn.completed', turnId: turn.id, outcome: 'interrupted' });
    }
    return live;
  }

  private async detach(live: LiveChat): Promise<void> {
    const session = live.session;
    live.session = undefined;
    live.grant?.revoke();
    live.grant = undefined;
    await session?.close().catch(() => undefined);
    this.flush(live);
  }

  async close(): Promise<void> {
    await Promise.all([...this.live.values()].map((l) => this.detach(l)));
    for (const live of this.live.values()) live.log?.end();
  }

  // ── plumbing ─────────────────────────────────────────────────────────────

  private settings(chat: ChatRecord): ChatSettings {
    const stored = this.deps.db.getSetting<Omit<ChatSettings, 'agent'> | null>(
      settingsKey(chat.id),
      null,
    );
    return {
      agent: chat.agent === 'codex' ? 'codex' : 'claude-code',
      ...(stored ? saved(stored) : {}),
    };
  }

  private summary(chat: ChatRecord): ChatSummary {
    const live = this.live.get(chat.id);
    return {
      id: chat.id,
      title: chat.title,
      agent: chat.agent === 'codex' ? 'codex' : 'claude-code',
      archived: chat.archived,
      ...(this.importRecord(chat.id) ? { kind: 'import' as const } : {}),
      live: live !== undefined && live.timeline.state.status !== 'idle',
      updatedAt: chat.updatedAt,
    };
  }

  /** Model and effort are always explicit, never inherited (agent-output.md 9.1). */
  private async withDefaults(
    agent: AgentId,
    cwd: string,
    settings: ChatSettings,
  ): Promise<ChatSettings> {
    // Defaults from Settings → Agents come first, then the agent's own default.
    const preset = this.deps.agents.defaults(agent);
    if (!settings.model && preset.model) {
      settings = {
        ...settings,
        model: preset.model,
        ...(preset.effort && !settings.effort ? { effort: preset.effort } : {}),
      };
    }
    if (settings.model && settings.effort) return settings;
    const models = await this.deps.agents.listModels(agent, cwd).catch(() => []);
    const model =
      models.find((m) => m.id === settings.model) ?? models.find((m) => m.isDefault) ?? models[0];
    if (!model) return settings;
    const effort =
      settings.effort ??
      model.defaultEffort ??
      (model.efforts.some((e) => e.id === 'medium') ? 'medium' : model.efforts[0]?.id);
    return { ...settings, model: model.id, ...(effort ? { effort } : {}) };
  }

  /** An absent agent is inactive: nothing starts until it is downloaded and signed in. */
  private async ensureAgent(agent: AgentId): Promise<void> {
    await this.deps.agents.requireReady(agent);
  }

  private touch(live: LiveChat): void {
    this.deps.db.updateChat(live.chat.id, {});
    live.chat = this.deps.db.getChat(live.chat.id) ?? live.chat;
    this.listChanged(live.projectId, live.chat.id);
  }

  /** An event Skaro itself adds to the chat; written to the log so replays keep it. */
  private skaroEvent(live: LiveChat, event: TimelineEvent): void {
    this.writeLine(live, {
      ts: Date.now() - live.chat.createdAt,
      dir: 'meta',
      line: { skaro: 'event', event },
    });
    this.onEvent(live, event);
  }

  private notice(
    live: LiveChat,
    code: 'session_restored' | 'session_lost' | 'other',
    level: 'info' | 'error',
    text: string,
  ): void {
    this.skaroEvent(live, {
      t: 'item.upsert',
      item: {
        id: `skaro-${code}-${randomUUID()}`,
        turnId: currentTurn(live),
        kind: 'notice',
        level,
        code,
        text,
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: code, ref: '' },
      },
    });
  }

  private writeLine(live: LiveChat, line: RawLine): void {
    if (!live.log) {
      const path = join(this.deps.dataDir, live.chat.logPath);
      mkdirSync(dirname(path), { recursive: true });
      const log = createWriteStream(path, { flags: 'a' });
      log.on('error', (error) => console.error(`chat log ${path}: ${error.message}`));
      live.log = log;
    }
    live.log.write(`${JSON.stringify(line)}\n`);
  }

  private flush(live: LiveChat): void {
    clearTimeout(live.flushTimer);
    live.flushTimer = undefined;
    if (!live.pending.length) return;
    const events = live.pending;
    live.pending = [];
    this.deps.emit('chat.events', {
      projectId: live.projectId,
      chatId: live.chat.id,
      seq: live.seq - events.length,
      events,
    });
  }

  private listChanged(projectId: string, chatId?: string): void {
    this.deps.emit('chats.changed', { projectId, ...(chatId ? { chatId } : {}) });
  }

  private project(projectId: string): ProjectContext {
    return this.deps.projects.get(projectId);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

function importKey(chatId: string): string {
  return `import.${chatId}`;
}

interface ImportWords {
  title: string;
  brief: string;
  architecture: string;
  files: (n: number) => string;
  text: (format: string) => string;
  table: (format: string) => string;
  skipped: (reason: string) => string;
}

const IMPORT_RU: ImportWords = {
  title: 'Импортировать документацию',
  brief: 'Бриф',
  architecture: 'Архитектура',
  files: (n) => {
    const d = n % 10;
    const h = n % 100;
    const word =
      d === 1 && h !== 11 ? 'файл' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'файла' : 'файлов';
    return `${n} ${word}`;
  },
  text: (f) => `${f} → текст`,
  table: (f) => `${f} → таблица`,
  skipped: (r) => `пропущен · ${r}`,
};

const IMPORT_EN: ImportWords = {
  title: 'Import documentation',
  brief: 'Brief',
  architecture: 'Architecture',
  files: (n) => `${n} ${n === 1 ? 'file' : 'files'}`,
  text: (f) => `${f} → text`,
  table: (f) => `${f} → table`,
  skipped: (r) => `skipped · ${r}`,
};

/** The "prepared" line's list: a path inside its source and what Skaro did with the file. */
function prepFiles(
  manifest: Manifest,
  words: ImportWords,
): { path: string; note: string; skipped: boolean }[] {
  const inSource = (source: string) => {
    const root = manifest.sources.find(
      (s) => source === s.display || source.startsWith(`${s.display}/`),
    );
    if (!root || source === root.display) return source.split('/').pop() ?? source;
    return source.slice(root.display.length + 1);
  };
  return manifest.files.map((f) => ({
    path: inSource(f.source),
    skipped: f.action === 'skipped',
    note:
      f.action === 'skipped'
        ? words.skipped(f.reason ?? '')
        : f.action === 'converted'
          ? ['xlsx', 'csv', 'tsv'].includes(f.format)
            ? words.table(f.format)
            : words.text(f.format)
          : f.format,
  }));
}

/** Goal and criteria of a staged task, goal and done criterion of a milestone. */
function fieldsOf(s: StagedArtifact): { goal?: string; doneWhen?: string; criteria?: string[] } {
  if (s.type === 'milestone') {
    const m = milestoneSections(s.body);
    return {
      ...(m.goal ? { goal: m.goal } : {}),
      ...(m.criteria ? { doneWhen: m.criteria } : {}),
    };
  }
  const t = taskSections(s.body);
  return {
    ...(t.goal ? { goal: t.goal } : {}),
    criteria: t.criteria.map((c) => c.text),
  };
}

/** Links of staged tasks must point to a staged artifact or an existing one. */
function importLinks(staged: StagedArtifact[], artifacts: ProjectArtifacts): string[] {
  const keys = new Map(staged.map((s) => [s.key, s.type]));
  const problems: string[] = [];
  for (const s of staged.filter((x) => x.type === 'task')) {
    if (
      s.milestone &&
      keys.get(s.milestone) !== 'milestone' &&
      !artifacts.milestones.some((m) => m.id === s.milestone!.toUpperCase())
    ) {
      problems.push(
        `${s.key}: milestone ${s.milestone} is neither a staged milestone nor an existing one.`,
      );
    }
    if (
      s.spec &&
      keys.get(s.spec) !== 'spec' &&
      !artifacts.specs.some((x) => x.id === adrId(s.spec!))
    ) {
      problems.push(
        `${s.key}: spec ${s.spec} is neither a staged specification nor an existing one.`,
      );
    }
    for (const dep of s.dependsOn ?? []) {
      if (keys.get(dep) !== 'task' && !artifacts.tasks.some((t) => t.id === dep.toUpperCase())) {
        problems.push(`${s.key}: depends_on ${dep} is neither a staged task nor an existing one.`);
      }
    }
  }
  return problems;
}

/** What a chat keeps of its settings: the agent is on the chat record itself. */
function saved(settings: Omit<ChatSettings, 'agent'>): Omit<ChatSettings, 'agent'> {
  return {
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
    ...(settings.permissionMode === 'full' ? { permissionMode: 'full' as const } : {}),
  };
}

/** A new chat takes the agent, model and effort of the last one, but always starts asking. */
function lastOf(settings: ChatSettings): ChatSettings {
  const { permissionMode: _mode, ...rest } = settings;
  return rest;
}

function settingsKey(chatId: string): string {
  return `chat.${chatId}.agent`;
}

function notesKey(chatId: string): string {
  return `chat.${chatId}.notes`;
}

function lastKey(projectId: string): string {
  return `chats.${projectId}.last`;
}

function currentTurn(live: LiveChat): string {
  return live.timeline.state.turns.at(-1)?.id ?? '';
}

/** Chat title: the first line of the first message that is not a file reference. */
export function titleOf(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const line = lines.find((l) => !l.startsWith('@')) ?? lines[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}

async function currentDoc(context: ProjectContext, path: string): Promise<string | undefined> {
  const artifacts = await context.load();
  const full = `.skaro/${path}`;
  const doc = [artifacts.brief, artifacts.architecture, ...artifacts.docs].find(
    (d) => d?.path === full,
  );
  return doc?.body;
}

function sameText(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.replace(/\s+$/, '') === b.replace(/\s+$/, '');
}

function adrId(value: string): string {
  const digits = /(\d+)/.exec(value)?.[1] ?? value;
  return digits.padStart(4, '0');
}

function nextNumber(ids: string[], pattern: RegExp): number {
  let max = 0;
  for (const id of ids) max = Math.max(max, Number(pattern.exec(id)?.[1] ?? 0));
  return max + 1;
}

/** A cycle among the dependencies of proposed tasks, if any. */
function findCycle(tasks: ProposedTaskArgs[]): string[] | undefined {
  const deps = new Map(tasks.map((t) => [t.ref, t.dependsOn]));
  const state = new Map<string, 'open' | 'done'>();
  const path: string[] = [];
  const visit = (ref: string): string[] | undefined => {
    if (state.get(ref) === 'done') return undefined;
    if (state.get(ref) === 'open') return [...path.slice(path.indexOf(ref)), ref];
    state.set(ref, 'open');
    path.push(ref);
    for (const dep of deps.get(ref) ?? []) {
      if (!deps.has(dep)) continue;
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(ref, 'done');
    return undefined;
  };
  for (const task of tasks) {
    const cycle = visit(task.ref);
    if (cycle) return cycle;
  }
  return undefined;
}

/** A task as text for the change card: title, milestone, dependencies, body. */
function taskText(task: Pick<Task, 'title' | 'milestone' | 'dependsOn' | 'body'>): string {
  return [
    `# ${task.title}`,
    '',
    ...(task.milestone ? [`milestone: ${task.milestone}`] : []),
    ...(task.dependsOn.length ? [`depends_on: ${task.dependsOn.join(', ')}`] : []),
    '',
    task.body.trim(),
    '',
  ].join('\n');
}

/** What a proposal is about, for the note to the agent. */
function describe(proposal: Proposal): string {
  switch (proposal.type) {
    case 'doc':
      return `the change to .skaro/${proposal.path}`;
    case 'adr':
      return `ADR "${proposal.title}"`;
    case 'spec':
      return `specification "${proposal.title}"`;
    case 'spec_change':
      return `the change to SPEC-${proposal.id} "${proposal.title}"`;
    case 'import':
      return 'the import of documentation';
    case 'plan':
      return proposal.milestone?.isNew
        ? `milestone "${proposal.milestone.title}" and its ${proposal.tasks.length} tasks`
        : `the ${proposal.tasks.length} proposed tasks (${proposal.tasks.map((t) => `"${t.title}"`).join(', ')})`;
    case 'task':
      return `the change to ${proposal.id} "${proposal.title}"`;
  }
}

/** What get_project_context returns: the whole project in one Markdown text. */
export function projectContextText(
  name: string,
  artifacts: ProjectArtifacts,
  runtime: Map<string, { state: Parameters<typeof displayStatus>[2] }>,
): string {
  const index = indexTasks(artifacts.tasks);
  const lines: string[] = [`# Project ${name}`.trim(), ''];
  const doc = (title: string, path: string, body: string | undefined) => {
    lines.push(`## ${title} (.skaro/${path})`, '', body?.trim() || '(not written yet)', '');
  };
  doc('Brief', 'brief.md', artifacts.brief?.body);
  doc('Architecture', 'architecture.md', artifacts.architecture?.body);
  lines.push('## ADRs', '');
  if (!artifacts.adrs.length) lines.push('(none)');
  for (const adr of artifacts.adrs) {
    lines.push(`- ADR-${adr.id} ${adr.title} — ${adr.status} (${adr.path})`);
  }
  lines.push('', '## Specifications', '');
  if (!artifacts.specs.length) lines.push('(none)');
  for (const spec of artifacts.specs) {
    lines.push(`- SPEC-${spec.id} ${spec.title} — ${spec.status} (${spec.path})`);
  }
  lines.push('', '## Documents', '');
  if (!artifacts.docs.length) lines.push('(none)');
  for (const d of artifacts.docs) lines.push(`- ${d.title} (${d.path})`);
  lines.push('', '## Milestones and tasks', '');
  const taskLine = (t: Task) => {
    const status = displayStatus(t, index, runtime.get(t.id)?.state);
    const deps = t.dependsOn.length ? `; depends on ${t.dependsOn.join(', ')}` : '';
    const spec = t.spec ? `; implements SPEC-${t.spec}` : '';
    return `- ${t.id} ${t.title} — ${status}${deps}${spec}${t.archived ? '; archived' : ''}`;
  };
  for (const m of artifacts.milestones) {
    lines.push(`### ${m.id} ${m.title}`, '');
    const tasks = artifacts.tasks.filter((t) => t.milestone === m.id);
    lines.push(...(tasks.length ? tasks.map(taskLine) : ['(no tasks)']), '');
  }
  const loose = artifacts.tasks.filter((t) => !t.milestone);
  if (loose.length) lines.push('### Without a milestone', '', ...loose.map(taskLine), '');
  if (!artifacts.milestones.length && !loose.length) lines.push('(none)', '');
  lines.push(
    `Documents from the chat ${artifacts.config.chat.autoAcceptDocs ? 'apply at once' : 'wait for the user to accept them'}.`,
  );
  return lines.join('\n');
}
