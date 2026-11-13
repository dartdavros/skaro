import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { DecisionReplies } from './decision-replies';
import { decisionHash } from './decision-projection';
import type { ProjectDecision } from '../shared/project-decisions';

// Pure decision protocol metadata and actual SQLite CAS; no project/backend/runtime fixture.
const entry: ProjectDecision = {
  id: 'observed-request',
  revision: decisionHash('observed-version'),
  origin: {
    projectId: process.cwd(),
    kind: 'task',
    id: 'protocol-observation',
    title: 'Protocol',
    epoch: 'observation',
  },
  kind: 'interaction',
  interaction: {
    id: 'observed-request',
    kind: 'question',
    delivery: 'async',
    questions: [
      {
        id: 'response',
        text: 'Protocol observation',
        options: [],
        header: 'Protocol',
        multi: false,
        allowFreeText: true,
        secret: true,
      },
    ],
  },
};
const reply = {
  kind: 'respond' as const,
  answer: { kind: 'question' as const, answers: { response: ['not-for-storage'] } },
};
it('shares one in-flight effect across views and replays only a completed durable receipt', async () => {
  const db = AppDb.open(':memory:');
  try {
    const replies = new DecisionReplies(db);
    let entered!: () => void,
      finish!: () => void,
      effects = 0;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const effect = async () => {
      effects++;
      entered();
      await gate;
    };
    const first = replies.accept(entry, reply, async () => {}, effect);
    await ready;
    await expect(
      replies.accept(
        entry,
        {
          ...reply,
          answer: { kind: 'question', answers: { response: ['different-private-value'] } },
        },
        async () => {},
        effect,
      ),
    ).rejects.toThrow('decision_answer_conflict');
    const second = replies.accept(entry, reply, async () => {}, effect);
    finish();
    await Promise.all([first, second]);
    await new DecisionReplies(db).accept(
      entry,
      reply,
      async () => {
        throw new Error('replay must not dispatch');
      },
      effect,
    );
    expect(effects).toBe(1);
    const key = `coordination.decision-reply.v1.${entry.origin.projectId}.${decisionHash([entry.id, entry.revision])}`;
    expect(JSON.stringify(db.getSetting(key, undefined))).not.toContain('not-for-storage');
    expect(db.getSetting<{ state: string } | undefined>(key, undefined)?.state).toBe('done');
  } finally {
    db.close();
  }
});
it('does not claim a stale request and never repeats an unknown partial effect', async () => {
  const db = AppDb.open(':memory:');
  try {
    const replies = new DecisionReplies(db);
    let effects = 0;
    await expect(
      replies.accept(
        entry,
        reply,
        async () => {
          throw new Error('decision_stale');
        },
        async () => {
          effects++;
        },
      ),
    ).rejects.toThrow('decision_stale');
    await expect(
      replies.accept(
        entry,
        reply,
        async () => {},
        async () => {
          effects++;
          throw new Error('unsettled');
        },
      ),
    ).rejects.toThrow('unsettled');
    await expect(
      new DecisionReplies(db).accept(
        entry,
        reply,
        async () => {},
        async () => {
          effects++;
        },
      ),
    ).rejects.toThrow('decision_reply_uncertain');
    expect(effects).toBe(1);
  } finally {
    db.close();
  }
});
it('serializes conflicting views and permits merge preparation before the terminal answer', async () => {
  const db = AppDb.open(':memory:');
  try {
    const replies = new DecisionReplies(db);
    let finish!: () => void;
    const hold = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let effects = 0;
    const first = replies.accept(
      entry,
      { kind: 'merge', action: { action: 'update_branch' } },
      async () => {},
      async () => {
        effects++;
        await hold;
      },
    );
    await expect(
      replies.accept(
        entry,
        { kind: 'merge', action: { action: 'cancel' } },
        async () => {},
        async () => {
          effects++;
        },
      ),
    ).rejects.toThrow('decision_answer_conflict');
    finish();
    await first;
    expect(replies.status(entry)).toBeUndefined();
    await replies.accept(
      entry,
      { kind: 'merge', action: { action: 'cancel' } },
      async () => {},
      async () => {
        effects++;
      },
    );
    expect(replies.status(entry)).toBe('denied');
    expect(effects).toBe(2);
  } finally {
    db.close();
  }
});
