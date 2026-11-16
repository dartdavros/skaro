import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { Timeline, type Interaction, type InteractionAnswer } from '@skaro/timeline';
import { ProjectCoordinators } from './project-coordinators';
import { coordinationHash, coordinationRequest } from './project-coordinator-request';
import { coordinatedSessionHandlers } from './coordinated-session-handlers';
import { dispatchQuestionReply } from './question-reply-dispatch';
import { projectDecisionProjection } from './decision-projection';
import { QuestionAnswers } from './question-answers';
import { DecisionNotDispatched } from './decision-not-dispatched';
import { coordinationToolScopeKey } from './coordination-tool-receipt';

async function protocol(db: AppDb) {
  const project = db.addProject({
    name: 'Observed Skaro repository',
    path: await realpath(process.cwd()),
  });
  const owner = 'question-protocol';
  const question: Extract<Interaction, { kind: 'question' }> = {
    kind: 'question',
    id: 'req-0',
    delivery: 'async',
    questions: [
      {
        id: 'resolution',
        text: 'Which authorized check?',
        header: '',
        multi: false,
        allowFreeText: true,
        options: [],
      },
    ],
  };
  const answer = {
    kind: 'question' as const,
    answers: { resolution: ['Inspect existing configuration'] },
  };
  const state = Timeline.from([
    { t: 'turn.started', turnId: 'epoch' },
    { t: 'interaction.opened', interaction: question },
  ]).state;
  const entry = projectDecisionProjection([
    { projectId: project.id, kind: 'chat', id: owner, title: '', epoch: 'log', timeline: state },
  ])[0]!;
  const coordinators = new ProjectCoordinators(db);
  const old = db.coordination.accept(
    coordinationRequest({
      id: randomUUID(),
      projectId: project.id,
      action: 'ipc.chat.respond',
      source: { kind: 'owner', id: 'renderer' },
      subject: { kind: 'chat', id: owner },
      inputHash: coordinationHash('previous native reply with unknown outcome'),
      scopeKey: `control:chat:${owner}`,
      mode: 'control',
    }),
  );
  db.coordination.claim(project.id, old.id, {
    expectedRevision: old.revision,
    claimId: randomUUID(),
  });
  db.coordination.recover(project.id);
  return { project: project.id, owner, question, answer, entry, coordinators, old: old.id };
}

it('reconciles exact committed acceptance after journal failure without inheriting a legacy owner-wide lock', async () => {
  const db = AppDb.open(':memory:');
  try {
    const p = await protocol(db);
    const handlers = coordinatedSessionHandlers(
      {
        'chat.respond': async (
          _project: string,
          _owner: string,
          _id: string,
          _answer: InteractionAnswer,
        ) => {
          new QuestionAnswers(db, `live.${p.owner}`).accept(
            p.question,
            p.answer,
            () => {
              throw new Error('Journal failed after the SQLite acceptance');
            },
            'epoch',
          );
        },
      },
      p.coordinators,
      db,
    );
    await dispatchQuestionReply(p.entry, p.answer, () =>
      handlers['chat.respond'](p.project, p.owner, p.question.id, p.answer),
    );
    expect(db.coordination.getOperation(p.project, p.old)?.state).toBe('uncertain');
    const replies = db.coordination.matching(
      p.project,
      'ipc.chat.respond',
      coordinationHash([p.project, p.owner, p.question.id, p.answer]),
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      state: 'succeeded',
      evidence: { code: 'question_acceptance_verified' },
    });
    expect(replies[0]!.scopeKey).toBe(`question-reply:${p.entry.revision}`);
  } finally {
    db.close();
  }
});

it('allows correction after a known pre-dispatch refusal but fences an unknown native reply for this question', async () => {
  const db = AppDb.open(':memory:');
  try {
    const p = await protocol(db);
    let entered = 0;
    const handlers = coordinatedSessionHandlers(
      {
        'chat.respond': async (
          _project: string,
          _owner: string,
          _id: string,
          _answer: InteractionAnswer,
        ) => {
          entered++;
          if (entered === 1) throw new DecisionNotDispatched('Owner must answer every field');
          throw new Error('Native reply outcome unknown');
        },
      },
      p.coordinators,
      db,
    );
    const reply = () =>
      dispatchQuestionReply(p.entry, p.answer, () =>
        handlers['chat.respond'](p.project, p.owner, p.question.id, p.answer),
      );
    await expect(reply()).rejects.toThrow('answer every field');
    await expect(reply()).rejects.toThrow('outcome unknown');
    await expect(reply()).rejects.toThrow();
    expect(entered).toBe(2);
    const rows = db.coordination.matching(
      p.project,
      'ipc.chat.respond',
      coordinationHash([p.project, p.owner, p.question.id, p.answer]),
    );
    expect(rows.map((op) => op.state).sort()).toEqual(['failed', 'queued', 'uncertain']);
  } finally {
    db.close();
  }
});

it('serializes one incident across task/chat presenters while independent owner commands avoid old reply locks', () => {
  const first = coordinationToolScopeKey(
    'plan_project_incident',
    'transport-1',
    'control:task:T',
    { incident_id: 'incident' },
    'project',
  );
  expect(
    coordinationToolScopeKey(
      'verify_project_incident',
      'transport-2',
      'control:chat:C',
      { incident_id: 'incident' },
      'project',
    ),
  ).toBe(first);
  const resume = coordinationToolScopeKey(
    'resume_task',
    'transport-3',
    'control:task:T',
    { command_id: 'owner-1' },
    'project',
  );
  expect(resume).not.toBe('control:task:T');
  expect(
    coordinationToolScopeKey(
      'resume_task',
      'transport-4',
      'control:task:T',
      { command_id: 'owner-1' },
      'project',
    ),
  ).toBe(resume);
  expect(
    coordinationToolScopeKey(
      'resume_task',
      'transport-5',
      'control:task:T',
      { command_id: 'owner-2' },
      'project',
    ),
  ).not.toBe(resume);
});
