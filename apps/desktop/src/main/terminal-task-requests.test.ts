import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { Timeline, type Interaction } from '@skaro/timeline';
import { TaskExecution } from './task-execution';
import {
  terminalTaskHistory,
  terminalTaskTimeline,
  retireTerminalTaskRequests,
} from './terminal-task-requests';

it('retires every request of a terminal or archived task despite durable follow-up and controller metadata', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Repository observation', path: process.cwd() });
    const run = db.createRun({
      projectId: project.id,
      taskId: 'observed',
      agent: 'codex',
      adapterVersion: 'observed',
      logPath: 'package.json',
    });
    const question: Interaction = {
      kind: 'question',
      delivery: 'async',
      id: 'old-native-question',
      questions: [],
    };
    const controller: Interaction = {
      kind: 'approval',
      delivery: 'async',
      id: 'coordinator:pending',
      choices: ['deny'],
      action: { type: 'other', title: 'Current controller decision' },
    };
    const timeline = Timeline.from([
      { t: 'interaction.opened', interaction: question },
      { t: 'interaction.opened', interaction: controller },
    ]);
    expect(terminalTaskHistory(db, 'done', run.id)).toBe(true);
    expect(terminalTaskHistory(db, 'cancelled', run.id)).toBe(true);
    expect(terminalTaskHistory(db, 'review', run.id)).toBe(false);
    expect(terminalTaskTimeline(timeline.state, true).interactions).toEqual([]);
    expect(timeline.state.interactions).toHaveLength(2);
    retireTerminalTaskRequests(timeline.state, true, (event) => timeline.apply(event));
    expect(timeline.state.interactions).toEqual([]);
    new TaskExecution(db, run.id).followUp('explicit-discussion', 'Explain the accepted result');
    expect(terminalTaskHistory(db, 'done', run.id)).toBe(true);
    expect(terminalTaskHistory(db, 'todo', run.id, true)).toBe(true);
    expect(terminalTaskHistory(db, 'in_progress', run.id, true)).toBe(true);
    timeline.apply({ t: 'interaction.opened', interaction: question });
    retireTerminalTaskRequests(timeline.state, terminalTaskHistory(db, 'done', run.id), (event) =>
      timeline.apply(event),
    );
    expect(timeline.state.interactions).toHaveLength(0);
    expect(terminalTaskHistory(db, 'done', run.id)).toBe(true); // Restart cannot revive old follow-up questions.
  } finally {
    db.close();
  }
});
