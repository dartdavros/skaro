import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { Timeline, type Interaction } from '@skaro/timeline';
import { TaskExecution } from './task-execution';
import { QuestionAnswers } from './question-answers';

it('preserves an incident answer in history while fencing its delivery after Stop and a renewed intent', () => {
  const db = AppDb.open(':memory:');
  try {
    const p = db.addProject({ name: 'Observed repository', path: process.cwd() });
    const run = db.createRun({
      projectId: p.id,
      taskId: 'metadata-observation',
      agent: 'codex',
      adapterVersion: 'observed',
      logPath: 'package.json',
    });
    const execution = new TaskExecution(db, run.id);
    execution.start();
    const question: Extract<Interaction, { kind: 'question' }> = {
      id: 'coordinator:observed',
      kind: 'question',
      delivery: 'async',
      questions: [
        {
          id: 'resolution',
          header: 'Decision',
          text: 'Resource ownership requires an owner decision',
          multi: false,
          allowFreeText: true,
          options: [],
        },
      ],
    };
    const timeline = Timeline.from([
      { t: 'turn.started', turnId: 'observed' },
      { t: 'interaction.opened', interaction: question },
    ]);
    const mailbox = new QuestionAnswers(db, `active.${run.id}`);
    mailbox.accept(
      question,
      { kind: 'question', answers: { resolution: ['Inspect the existing resource'] } },
      (event) => timeline.apply(event),
      'observed',
      { runId: run.id, intent: execution.intentVersion() },
    );
    expect(mailbox.pending(timeline.state)).toBeDefined();
    execution.stop();
    expect(mailbox.pending(timeline.state)).toBeUndefined();
    execution.start();
    expect(mailbox.pending(timeline.state)).toBeUndefined();
    const restored = new Timeline();
    mailbox.recover(restored.state, (event) => restored.apply(event));
    expect(restored.state.items.some((i) => i.kind === 'decision')).toBe(true);
    expect(mailbox.pending(restored.state)).toBeUndefined();
    expect(db.commands.pending()).toEqual([]);
  } finally {
    db.close();
  }
});
