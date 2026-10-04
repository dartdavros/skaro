// Project chats (architecture.md 9, agent-output.md 5.4): an agent session per chat in the
// project's main working copy, in the "ask" mode (the user confirms edits and commands in cards)
// or with full access, with Skaro's tools for documents, ADRs, milestones and
// tasks. The agent's proposals are items of the chat timeline; the user decides on them in cards,
// and the decisions reach the agent with the user's next message.
import { randomUUID } from 'node:crypto';
import { type Proposal, type ProposalResult } from '@skaro/timeline';
import type { ProposalAction } from '../shared/ipc';
import { removeImport } from './imports';
import type { ProjectContext } from './projects';
import { type ProposalItem, LiveChat } from './chat-model';
import { notesKey, currentTurn } from './chat-settings-helpers';
import { currentDoc, sameText, describe } from './chat-proposal-helpers';

import type { ChatEngine } from './chat-engine';

export class ChatProposals {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }
  // ── proposals: the user's decisions ──────────────────────────────────────

  async proposal(
    projectId: string,
    chatId: string,
    itemId: string,
    action: ProposalAction,
  ): Promise<void> {
    const live = await this.ctx.history.restore(projectId, chatId);
    const item = live.timeline.state.items.find(
      (i): i is ProposalItem => i.kind === 'proposal' && i.id === itemId,
    );
    if (!item) throw new Error('The proposal is no longer in the chat');
    const context = this.ctx.project(projectId);
    let next: ProposalItem;
    let note: string;
    try {
      if (action.action === 'reject') {
        if (item.state !== 'pending') throw new Error('The proposal is already decided');
        if (item.proposal.type === 'import') {
          const record = this.ctx.importReview.importRecord(chatId);
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
    this.ctx.history.skaroEvent(live, { t: 'item.upsert', item: next });
    this.addNotes(chatId, [note]);
    this.ctx.deps.emit('project.changed', { projectId });
  }

  async apply(
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
        this.ctx.deps.db.addEvent(live.projectId, 'doc_updated', { path: proposal.path });
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
        this.ctx.deps.db.addEvent(live.projectId, 'adr_accepted', { id: adr.id, title: adr.title });
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
        this.ctx.deps.db.addEvent(live.projectId, 'spec_accepted', {
          id: spec.id,
          title: spec.title,
        });
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
        this.ctx.deps.db.addEvent(live.projectId, 'spec_updated', { id: proposal.id });
        return {
          result: { spec: { id: proposal.id, title: proposal.title } },
          note: `The user accepted the change to SPEC-${proposal.id} "${proposal.title}".`,
        };
      }
      case 'import':
        return this.ctx.importReview.applyImportProposal(live, context, action.import);
      case 'plan':
        return this.ctx.plan.applyPlan(live, context, proposal, action.tasks);
      case 'task': {
        await store.readTask(proposal.id);
        await store.updateTask(proposal.id, proposal.patch);
        this.ctx.deps.db.addEvent(live.projectId, 'task_changed', { task: proposal.id });
        return { note: `The user accepted the change to ${proposal.id} "${proposal.title}".` };
      }
    }
  }

  async revertDoc(
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

  proposals(live: LiveChat): ProposalItem[] {
    return live.timeline.state.items.filter((i): i is ProposalItem => i.kind === 'proposal');
  }

  addProposal(live: LiveChat, proposal: Proposal, state: ProposalItem['state']): void {
    this.ctx.history.skaroEvent(live, {
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

  takeNotes(chatId: string): string[] {
    const notes = this.ctx.deps.db.getSetting<string[] | null>(notesKey(chatId), null) ?? [];
    if (notes.length) this.ctx.deps.db.setSetting(notesKey(chatId), []);
    return notes;
  }

  addNotes(chatId: string, notes: string[]): void {
    if (!notes.length) return;
    const current = this.ctx.deps.db.getSetting<string[] | null>(notesKey(chatId), null) ?? [];
    this.ctx.deps.db.setSetting(notesKey(chatId), [...current, ...notes]);
  }
}
