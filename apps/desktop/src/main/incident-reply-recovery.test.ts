import { expect, it } from 'vitest';
import { observeIncidentApproval } from './incident-reply-test-support';
import { commitIncidentApproval } from './incident-answer-validation';
import { DecisionReplies, decisionReplyStatus } from './decision-replies';
import { DecisionNotDispatched } from './decision-not-dispatched';
import { decisionHash } from './decision-projection';
import { incidentApprovalProof } from './incident-reply-proof';
import { recoverIncidentOperations } from './incident-operation-recovery';
import { coordinationHash } from './project-coordinator-request';

const answer = {
  kind: 'respond' as const,
  answer: { kind: 'approval' as const, choice: 'allow_once' as const },
};

it('rolls back both consent and canonical decision on a stale commit, and commits both on success', async () => {
  const o = await observeIncidentApproval();
  try {
    const { db, policy, prepared } = o;
    expect(() =>
      commitIncidentApproval(
        db,
        policy,
        {
          ...prepared,
          decision: { ...prepared.decision, revision: prepared.decision.revision + 1 },
        },
        'allow_once',
      ),
    ).toThrow(DecisionNotDispatched);
    expect(policy.approval(prepared.action)).toBeUndefined();
    expect(db.coordination.decisions.get(o.project.id, prepared.decision.id)?.state).toBe(
      'pending',
    );
    commitIncidentApproval(db, policy, prepared, 'allow_once');
    expect(policy.approval(prepared.action)?.decision).toBe('allow');
    expect(db.coordination.decisions.get(o.project.id, prepared.decision.id)?.state).toBe(
      'answered',
    );
  } finally {
    await o.close();
  }
});

it('acknowledges committed consent despite a later journal failure and never dispatches the reply again', async () => {
  const o = await observeIncidentApproval();
  try {
    let effects = 0;
    await new DecisionReplies(o.db).accept(
      o.entry,
      answer,
      async () => {},
      async () => {
        effects++;
        commitIncidentApproval(o.db, o.policy, o.prepared, 'allow_once');
        throw new Error('journal became unavailable after consent');
      },
    );
    expect(decisionReplyStatus(o.db, o.entry)).toBe('answered');
    await new DecisionReplies(o.db).accept(
      o.entry,
      answer,
      async () => {},
      async () => {
        effects++;
      },
    );
    expect(effects).toBe(1);
  } finally {
    await o.close();
  }
});

it('recovers a legacy uncertain validation failure only when canonical metadata proves no consent or dispatch', async () => {
  const o = await observeIncidentApproval();
  try {
    const key = `coordination.decision-reply.v1.${o.project.id}.${decisionHash([o.entry.id, o.entry.revision])}`;
    o.db.setSetting(key, {
      revision: o.entry.revision,
      answer: decisionHash(answer),
      outcome: 'answered',
      state: 'uncertain',
    });
    expect(incidentApprovalProof(o.db, o.project.id, o.prepared.decision.id, 'allow_once')).toBe(
      'not_dispatched',
    );
    let effects = 0;
    await new DecisionReplies(o.db).accept(
      o.entry,
      answer,
      async () => {},
      async () => {
        effects++;
        commitIncidentApproval(o.db, o.policy, o.prepared, 'allow_once');
      },
    );
    expect(effects).toBe(1);
    expect(decisionReplyStatus(o.db, o.entry)).toBe('answered');
  } finally {
    await o.close();
  }
});

it('preserves ambiguous partial consent and never treats an unanswered receipt as a new permission', async () => {
  const o = await observeIncidentApproval();
  try {
    o.policy.decide(
      o.prepared.action,
      true,
      'owner',
      'actual partial metadata commit',
      o.prepared.request.expiresAt,
    );
    const key = `coordination.decision-reply.v1.${o.project.id}.${decisionHash([o.entry.id, o.entry.revision])}`;
    o.db.setSetting(key, {
      revision: o.entry.revision,
      answer: decisionHash(answer),
      outcome: 'answered',
      state: 'uncertain',
    });
    expect(
      incidentApprovalProof(o.db, o.project.id, o.prepared.decision.id, 'allow_once'),
    ).toBeUndefined();
    let effects = 0;
    await expect(
      new DecisionReplies(o.db).accept(
        o.entry,
        answer,
        async () => {},
        async () => {
          effects++;
        },
      ),
    ).rejects.toThrow('decision_reply_uncertain');
    expect(effects).toBe(0);
  } finally {
    await o.close();
  }
});

it('reconciles the exact legacy IPC fence after restart but leaves a different command unknown', async () => {
  const o = await observeIncidentApproval();
  try {
    const command = (id: string, raw: string, scopeKey: string) =>
      o.coordinators.execute(
        {
          id,
          projectId: o.project.id,
          action: 'ipc.task.respond',
          source: { kind: 'owner', id: 'renderer' },
          subject: { kind: 'task', id: o.taskId },
          mode: 'control',
          scopeKey,
          inputHash: coordinationHash([o.project.id, o.taskId, raw, answer.answer]),
        },
        async () => {
          throw new Error('old dispatcher lost validation result');
        },
      );
    await expect(command('known', o.entry.id, 'known-owner')).rejects.toThrow();
    await expect(
      command('different', 'unrelated-native-request', 'another-owner'),
    ).rejects.toThrow();
    recoverIncidentOperations(o.db, o.project.id);
    expect(o.db.coordination.getOperation(o.project.id, 'known')?.state).toBe('failed');
    expect(o.db.coordination.getOperation(o.project.id, 'different')?.state).toBe('uncertain');
    // The original scope is available again; no external command was replayed during recovery.
    await expect(
      o.coordinators.execute(
        {
          id: 'renewed',
          projectId: o.project.id,
          action: 'ipc.task.respond',
          source: { kind: 'owner', id: 'renderer' },
          subject: { kind: 'task', id: o.taskId },
          mode: 'control',
          scopeKey: 'known-owner',
          inputHash: coordinationHash('fresh request'),
        },
        () => 'available',
      ),
    ).resolves.toBe('available');
    await expect(
      o.coordinators.execute(
        {
          id: 'committed-lost',
          projectId: o.project.id,
          action: 'ipc.task.respond',
          source: { kind: 'owner', id: 'renderer' },
          subject: { kind: 'task', id: o.taskId },
          mode: 'control',
          scopeKey: 'known-owner',
          inputHash: coordinationHash([o.project.id, o.taskId, o.entry.id, answer.answer]),
        },
        () => {
          commitIncidentApproval(o.db, o.policy, o.prepared, 'allow_once');
          throw new Error('acknowledgement lost');
        },
      ),
    ).rejects.toThrow();
    recoverIncidentOperations(o.db, o.project.id);
    expect(o.db.coordination.getOperation(o.project.id, 'committed-lost')?.state).toBe('succeeded');
    expect(o.db.coordination.getOperation(o.project.id, 'different')?.state).toBe('uncertain');
  } finally {
    await o.close();
  }
});

it('does not fence a task after a known non-dispatch, and allows an explicit denial after failed validation', async () => {
  const o = await observeIncidentApproval();
  try {
    await expect(
      o.coordinators.execute(
        {
          id: 'validation',
          projectId: o.project.id,
          action: 'ipc.task.respond',
          source: { kind: 'owner', id: 'renderer' },
          subject: { kind: 'task', id: o.taskId },
          mode: 'control',
          scopeKey: 'same-owner',
          inputHash: coordinationHash('validation'),
        },
        () => {
          throw new DecisionNotDispatched('decision_stale');
        },
      ),
    ).rejects.toThrow('decision_stale');
    expect(o.db.coordination.getOperation(o.project.id, 'validation')?.state).toBe('failed');
    const replies = new DecisionReplies(o.db);
    await expect(
      replies.accept(
        o.entry,
        answer,
        async () => {},
        async () => {
          throw new DecisionNotDispatched('validation rejected before consent');
        },
      ),
    ).rejects.toThrow('validation rejected');
    const deny = {
      kind: 'respond' as const,
      answer: { kind: 'approval' as const, choice: 'deny' as const },
    };
    await replies.accept(
      o.entry,
      deny,
      async () => {},
      async () => {
        commitIncidentApproval(o.db, o.policy, o.prepared, 'deny');
      },
    );
    expect(decisionReplyStatus(o.db, o.entry)).toBe('denied');
  } finally {
    await o.close();
  }
});
