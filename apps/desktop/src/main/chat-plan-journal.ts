import type { NewTask } from '@skaro/core';
import type { ChatEngine } from './chat-engine';
import type { LiveChat, ProposalItem } from './chat-model';
import { ChatPlanningStore, type SavedChatPlan } from './chat-planning-store';

export interface PlanDecision {
  revisedDraft?: SavedChatPlan;
  item: ProposalItem;
  milestoneId?: string;
  milestoneIds?: Record<string, string>;
  creating?: { ref: string; id: string; input: NewTask };
}

/** SQLite commits the decision/progress before the timeline or artifact write. */
export class PlanJournal {
  private readonly ctx: ChatEngine;
  private readonly live: LiveChat;
  constructor(ctx: ChatEngine, live: LiveChat) {
    this.ctx = ctx;
    this.live = live;
  }
  private get key() {
    return `chat.plan-decisions.${this.live.chat.id}`;
  }
  list(): PlanDecision[] {
    return this.ctx.deps.db.getSetting<PlanDecision[]>(this.key, []);
  }
  save(decision: PlanDecision): void {
    this.saveAll([decision]);
  }
  saveAll(decisions: PlanDecision[]): void {
    const records = this.list();
    let changed = false;
    for (const decision of decisions) {
      const index = records.findIndex((r) => r.item.id === decision.item.id);
      if (index >= 0 && JSON.stringify(records[index]) === JSON.stringify(decision)) continue;
      if (index < 0) records.push(decision);
      else records[index] = decision;
      changed = true;
    }
    if (!changed) return;
    this.ctx.deps.db.setSetting(this.key, records);
    for (const decision of decisions) this.publish(decision);
  }
  restore(): void {
    for (const record of this.list()) this.publish(record);
  }
  private publish(record: PlanDecision): void {
    if (record.revisedDraft) {
      const store = new ChatPlanningStore(this.ctx.deps.db, this.live.chat.id);
      if ((store.get(record.revisedDraft.key)?.revision ?? 0) < record.revisedDraft.revision!)
        store.put(record.revisedDraft);
    }
    const current = this.live.timeline.state.items.find((i) => i.id === record.item.id);
    if (JSON.stringify(current) !== JSON.stringify(record.item)) {
      this.ctx.history.skaroEvent(this.live, { t: 'item.upsert', item: record.item });
    }
  }
}
