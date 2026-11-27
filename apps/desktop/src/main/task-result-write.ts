import type { SubmitResultArgs, ToolResult } from '@skaro/mcp-server';
import { setCriteria, taskSections } from './task-body';
import type { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { readSubject, updateSubject } from './task-subject';
import { completedTaskReply } from './task-merge-result';
import { operationFailure } from '@skaro/mcp-server';
import { saveTaskAcceptanceReport } from './task-acceptance-report';

/** Only validation and criterion mutation belong under the project gate; scheduling runs afterward. */
export async function writeTaskResult(
  ctx: TaskRunEngine,
  active: ActiveRun,
  args: SubmitResultArgs,
  beforeWrite?: () => Promise<void>,
) {
  const context = ctx.project(active.projectId);
  const task = await readSubject(context, active.taskId);
  const reply = (value: ToolResult) => ({ kind: 'reply' as const, reply: value });
  if (task.status === 'done') {
    ctx.results.closeMergeCard(active, 'answered');
    const artifacts = await context.load();
    return reply({ text: completedTaskReply(active, artifacts.config.baseBranch, ctx.deps.db) });
  }
  const criteria = taskSections(task.body).criteria;
  const verdicts = new Map(args.criteria.map((value) => [value.number, value]));
  const wrong = [...verdicts.keys()].filter((number) => number > criteria.length);
  const missing = criteria.map((_, index) => index + 1).filter((number) => !verdicts.has(number));
  if (wrong.length || missing.length)
    return reply({
      text:
        `The task has ${criteria.length} acceptance criteria, numbered 1–${criteria.length}. ` +
        (missing.length ? `No verdict for: ${missing.join(', ')}. ` : '') +
        (wrong.length ? `No such criteria: ${wrong.join(', ')}. ` : '') +
        'Give a verdict for every criterion and call submit_result again.',
      isError: true,
    });
  const met = criteria.map((_, index) => verdicts.get(index + 1)!.met);
  try {
    await beforeWrite?.();
  } catch (error) {
    return reply(operationFailure(error, 'submit_result'));
  }
  const body = setCriteria(task.body, met);
  await updateSubject(context, task.id, { body });
  saveTaskAcceptanceReport(
    ctx.deps.db,
    active.run.id,
    { ...task, body },
    active.secrets.redact({
      criteria: criteria.map((criterion) => criterion.text),
      verdicts: args.criteria,
      summary: args.summary,
      verification: args.verification,
      observations: args.verificationObservations,
    }),
  );
  return { kind: 'written' as const, task, met };
}
