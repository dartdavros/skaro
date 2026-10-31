import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Timeline, replayRunLog } from '@skaro/timeline';
import { AppDb } from '@skaro/core';
import { ChatPlanningStore } from './chat-planning-store';
import { savedPlanStatus } from './chat-planning-status';

import { dialoguePlan, planningWorkspace } from './chat-planning-test-workspace';
import { projectorFor } from './session-log';

describe('saved project planning with real persistence', () => {
  it('presents all 75 tasks in one review even when called with the legacy milestone argument', async () => {
    const w = await planningWorkspace();
    try {
      await w.engine.planning.prepare(w.live, dialoguePlan());
      expect((await w.engine.planning.finish(w.live, { key: 'dialogue' })).isError).toBe(true);
      await w.engine.planning.propose(w.live, { key: 'dialogue', milestone: 'M08' });
      await w.engine.planning.propose(w.live, { key: 'dialogue' });
      const cards = w.engine.proposals.proposals(w.live);
      expect(cards).toHaveLength(1);
      expect(cards[0]!.proposal).toMatchObject({ complete: true });
      const plan = w.engine.planning.store(w.live).get('dialogue')!;
      expect(
        savedPlanStatus(plan, w.live.timeline.state.items, await w.store.load()).counts,
      ).toMatchObject({ proposed: 75, pending: 75, unproposed: 0 });
      expect((await w.engine.planning.finish(w.live, { key: 'dialogue' })).isError).toBeUndefined();
      expect((await w.store.load()).tasks).toHaveLength(0);
    } finally {
      await w.close();
    }
  });
  it('rejects incomplete records, uncovered requirements and overwriting a saved plan', async () => {
    const w = await planningWorkspace();
    try {
      const args = dialoguePlan();
      expect(
        (await w.engine.planning.prepare(w.live, { ...args, expectedTotal: 76 })).isError,
      ).toBe(true);
      args.milestones[0]!.requirements.push('SPEC-0001:R-missing');
      expect((await w.engine.planning.prepare(w.live, args)).isError).toBe(true);
      expect(w.engine.planning.store(w.live).list()).toHaveLength(0);
      await w.engine.planning.prepare(w.live, dialoguePlan());
      expect((await w.engine.planning.prepare(w.live, dialoguePlan())).isError).toBeUndefined();
      expect(
        (await w.engine.planning.prepare(w.live, { ...dialoguePlan(), title: 'Другой состав' }))
          .isError,
      ).toBe(true);
      expect(w.engine.planning.store(w.live).list()).toHaveLength(1);
    } finally {
      await w.close();
    }
  });

  it('preserves owner rejection and counters instead of re-proposing rejected cards', async () => {
    const w = await planningWorkspace();
    try {
      await w.engine.planning.prepare(w.live, dialoguePlan());
      await w.engine.planning.propose(w.live, { key: 'dialogue', milestone: 'M08' });
      await w.engine.planning.control(w.live, {
        key: 'dialogue',
        action: 'pause',
        reason: 'Проверка решений владельца',
      });
      const card = w.engine.proposals.proposals(w.live)[0]!;
      await w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, card.id, {
        action: 'reject',
      });
      await w.engine.planning.control(w.live, {
        key: 'dialogue',
        action: 'resume',
        reason: 'Продолжить остальные этапы',
      });
      await w.engine.planning.propose(w.live, { key: 'dialogue', milestone: 'M08' });
      expect(w.engine.proposals.proposals(w.live)).toHaveLength(1);
      const status = savedPlanStatus(
        w.engine.planning.store(w.live).get('dialogue')!,
        w.live.timeline.state.items,
        await w.store.load(),
      );
      expect(status.counts).toMatchObject({ proposed: 75, rejected: 75, unproposed: 0 });
    } finally {
      await w.close();
    }
  });

  it('reopens SQLite and replays saved cards without losing the remaining plan', async () => {
    const w = await planningWorkspace();
    try {
      await w.engine.planning.prepare(w.live, dialoguePlan());
      await w.engine.planning.propose(w.live, { key: 'dialogue', milestone: 'M08' });
      // Flush the actual append-only chat log before opening an independent reader.
      await new Promise<void>((resolve, reject) =>
        w.live.log!.write('', (error) => (error ? reject(error) : resolve())),
      );
      const lines = (await readFile(join(w.root, 'chat.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const replayed = Timeline.from(
        replayRunLog(lines, w.live.chat.createdAt, await projectorFor('codex'), (image) =>
          w.engine.deps.attachments.save(image),
        ),
      );
      const reopened = AppDb.open(join(w.root, 'skaro.db'));
      try {
        const plan = new ChatPlanningStore(reopened, w.live.chat.id).get('dialogue')!;
        expect(
          savedPlanStatus(plan, replayed.state.items, await w.store.load()).counts,
        ).toMatchObject({ prepared: 75, proposed: 75, unproposed: 0 });
      } finally {
        reopened.close();
      }
    } finally {
      await w.close();
    }
  });
});
