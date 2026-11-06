import { afterAll, expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { emptyTimeline, Timeline, type Interaction } from '@skaro/timeline';
import { taskResumeTool } from '@skaro/mcp-server';
import { TaskExecution } from './task-execution';
import { prepareTaskFollowUp } from './task-follow-up';
import { resumeTaskExecution } from './task-resume';
import { taskAgentInput } from './task-agent-input';
import { QuestionAnswers } from './question-answers';

// Real SQLite settings and timeline DTOs only; no project, fake agent or API is created.
const db = AppDb.open(':memory:');
afterAll(() => db.close());
const question: Extract<Interaction, { kind: 'question' }> = {
  kind: 'question',
  id: 'decision',
  delivery: 'async',
  questions: [
    {
      id: 'environment',
      header: 'Окружение',
      text: 'Есть изолированное окружение?',
      multi: false,
      allowFreeText: true,
      options: [
        { label: 'Есть', description: 'Указать существующее окружение.' },
        { label: 'Нет', description: 'Проверка останется заблокированной.' },
      ],
    },
  ],
};

it('answers an owner question without re-enabling execution or erasing the blocker after restoration', () => {
  const execution = new TaskExecution(db, 'follow-up-blocked');
  execution.start();
  execution.next('first', 'unchanged');
  execution.next('second', 'unchanged');
  execution.block('The recovery environment is unavailable');
  const input = prepareTaskFollowUp(execution, { text: 'Что от меня требуется?' }, emptyTimeline());
  expect(execution.read()).toMatchObject({
    enabled: false,
    stalls: 1,
    blocked: 'The recovery environment is unavailable',
  });
  expect(new TaskExecution(db, 'follow-up-blocked').read()).toEqual(execution.read());
  const delivered = taskAgentInput(input, emptyTimeline(), true);
  expect(delivered.text).toContain('answer it and end this turn');
  expect(delivered.text).toContain('resume_task');
  // A retry of the durable input cannot reset the stop or the stall count.
  prepareTaskFollowUp(execution, input, emptyTimeline());
  expect(execution.read()).toMatchObject({ enabled: false, stalls: 1 });
});

it('resumes only the current owner instruction and rejects stale quotes and calls after Stop', async () => {
  const execution = new TaskExecution(db, 'follow-up-resume');
  execution.start();
  prepareTaskFollowUp(execution, { commandId: 'old', text: 'Продолжай работу' }, emptyTimeline());
  prepareTaskFollowUp(
    execution,
    { commandId: 'new', text: 'Исправь проверку и продолжай работу' },
    emptyTimeline(),
  );
  const tool = taskResumeTool(async (id, instruction) =>
    resumeTaskExecution(execution, emptyTimeline(), id, instruction),
  );
  const scope = {
    kind: 'task' as const,
    projectId: 'scope',
    taskId: 'T-1',
    runId: 'follow-up-resume',
  };
  expect(
    (await tool.call({ command_id: 'old', instruction: 'Продолжай работу' }, scope)).isError,
  ).toBe(true);
  expect(
    (await tool.call({ command_id: 'new', instruction: 'invented consent' }, scope)).isError,
  ).toBe(true);
  expect((await tool.call({ command_id: 'new', instruction: ' ' }, scope)).isError).toBe(true);
  expect(
    (
      await tool.call(
        { command_id: 'new', instruction: 'Исправь проверку' },
        { kind: 'project_chat', projectId: 'scope' },
      )
    ).isError,
  ).toBe(true);
  expect(execution.read().enabled).toBe(false);
  expect(
    (await tool.call({ command_id: 'new', instruction: 'Исправь проверку' }, scope)).isError,
  ).toBeUndefined();
  expect(execution.read().enabled).toBe(true);
  execution.next('first', 'unchanged');
  execution.next('second', 'unchanged');
  await tool.call({ command_id: 'new', instruction: 'Исправь проверку' }, scope);
  expect(execution.read().stalls).toBe(1);
  execution.stop();
  expect(
    (await tool.call({ command_id: 'new', instruction: 'Исправь проверку' }, scope)).isError,
  ).toBe(true);
});

it('keeps option cards open through clarification, completion and replay; only a complete answer resumes prior work', () => {
  const execution = new TaskExecution(db, 'follow-up-question');
  execution.start();
  const timeline = Timeline.from([
    { t: 'turn.started', turnId: 'waiting' },
    { t: 'interaction.opened', interaction: question },
  ]);
  prepareTaskFollowUp(
    execution,
    { commandId: 'clarify', text: 'О каком окружении речь?' },
    timeline.state,
  );
  expect(() =>
    resumeTaskExecution(execution, timeline.state, 'clarify', 'О каком окружении речь?'),
  ).toThrow('Answer the open questions');
  timeline.apply({ t: 'turn.completed', turnId: 'waiting', outcome: 'interrupted' });
  const restored = Timeline.restore(structuredClone(timeline.state));
  expect(restored.state.interactions).toEqual([question]);
  expect(restored.state.status).toBe('waiting');
  const mailbox = new QuestionAnswers(db, 'follow-up-question');
  expect(() =>
    mailbox.accept(question, { kind: 'question', answers: {} }, (event) => restored.apply(event)),
  ).toThrow('Answer every question');
  expect(execution.read().enabled).toBe(false);
  mailbox.accept(question, { kind: 'question', answers: { environment: ['Нет'] } }, (event) =>
    restored.apply(event),
  );
  const answer = mailbox.pending(restored.state)!;
  prepareTaskFollowUp(execution, answer, restored.state, answer);
  expect(restored.state.interactions).toEqual([]);
  expect(execution.read().enabled).toBe(true);
});

it('does not turn an answer in a conversational turn into authorization for the original task', () => {
  const execution = new TaskExecution(db, 'follow-up-conversation');
  execution.start();
  prepareTaskFollowUp(
    execution,
    { commandId: 'explain', text: 'Почему ты ждёшь?' },
    emptyTimeline(),
  );
  const timeline = Timeline.from([{ t: 'interaction.opened', interaction: question }]);
  prepareTaskFollowUp(
    execution,
    { commandId: 'clarify', text: 'Что значит изолированное?' },
    timeline.state,
  );
  const mailbox = new QuestionAnswers(db, 'follow-up-conversation');
  mailbox.accept(question, { kind: 'question', answers: { environment: ['Нет'] } }, (event) =>
    timeline.apply(event),
  );
  const answer = mailbox.pending(timeline.state)!;
  prepareTaskFollowUp(execution, answer, timeline.state, answer);
  expect(execution.read().enabled).toBe(false);
  const internal = {
    internal: true,
    commandId: 'continue-original',
    text: 'Continue authorized work',
  };
  expect(prepareTaskFollowUp(execution, internal, timeline.state)).toBe(internal);
  expect(execution.read().enabled).toBe(false);
});
