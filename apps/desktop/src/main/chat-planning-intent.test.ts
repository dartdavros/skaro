import { AppDb } from '@skaro/core';
import { Timeline } from '@skaro/timeline';
import { expect, it } from 'vitest';
import { LiveChat, type ProposalItem } from './chat-model';
import {
  beginPlanningIntent,
  nextPlanningIntent,
  stopPlanningIntent,
} from './chat-planning-intent';

it('retains the request across reload and waits for the exact C4 prerequisite to apply', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Planning controller', path: 'planning-controller' });
    const chat = db.createChat({
      projectId: project.id,
      agent: 'codex',
      title: 'Plan',
      logPath: 'chat.jsonl',
    });
    const live = new LiveChat(project.id, chat, new Timeline());
    expect(nextPlanningIntent(db, live)).toBeUndefined();
    expect(beginPlanningIntent(db, live).isError).toBeUndefined();
    const packageId = 'architecture-package';
    const proposal: ProposalItem = {
      kind: 'proposal',
      id: packageId,
      turnId: '',
      state: 'pending',
      status: 'done',
      startedAt: 1,
      native: { agent: 'skaro', type: 'proposal', ref: packageId },
      proposal: {
        type: 'architecture',
        packageId,
        title: 'Specification',
        summary: '',
        baseRevision: 0,
      },
    };
    live.timeline.apply({ t: 'item.upsert', item: proposal });
    expect(beginPlanningIntent(db, live, packageId).isError).toBeUndefined();
    expect(nextPlanningIntent(db, live)).toBeUndefined();

    const reopened = new LiveChat(project.id, chat, new Timeline());
    reopened.timeline.apply({ t: 'item.upsert', item: { ...proposal, state: 'accepted' } });
    expect(nextPlanningIntent(db, reopened)).toBeUndefined();
    reopened.timeline.apply({ t: 'item.upsert', item: { ...proposal, state: 'applied' } });
    expect(nextPlanningIntent(db, reopened)).toBe('continue');
    expect(nextPlanningIntent(db, reopened)).toBe('continue');
    expect(nextPlanningIntent(db, reopened)).toBe('exhausted');
    expect(nextPlanningIntent(db, reopened)).toBeUndefined();
    beginPlanningIntent(db, reopened, packageId);
    stopPlanningIntent(db, reopened);
    expect(nextPlanningIntent(db, reopened)).toBeUndefined();
  } finally {
    db.close();
  }
});
