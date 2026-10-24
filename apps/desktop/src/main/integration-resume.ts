import { projectRecords } from './project-records';
import type { TaskRunEngine } from './task-run-engine';
import { errorText } from './session-log';
import { recoverIntegrationStarts } from './integration-recovery';
import { recoverLegacyCheckShell } from './integration-shell-recovery';
import { dropInheritedMergeChecks } from './integration-merge-checks';

export async function recoverIntegrations(ctx: TaskRunEngine): Promise<void> {
  const integration = ctx.integrations;
  if (integration.closing) return;
  for await (const project of projectRecords(ctx.deps.db))
    for (const op of integration.store.all(project.id)) {
      if (integration.closing) return;
      if (integration.executing(op.id)) continue;
      if (['applied', 'stale'].includes(op.state) && !op.worker && !op.executor) continue;
      try {
        await ctx.processes.stop(`verification-${op.id}`);
        if (op.worker) {
          await ctx.processes.stop(op.worker);
          op.worker = undefined;
          integration.service.save(op);
        }
        op.executor = undefined;
        integration.service.save(op);
        await integration.history.recover(op);
        await integration.controls.recover(op);
        if (recoverLegacyCheckShell(op)) {
          integration.service.save(op);
          await integration.history.notice(
            op,
            'Skaro восстановил оболочку сохранённой проверки. Проверка кандидата продолжится автоматически.',
          );
        }
        // A merge candidate from before merges went per task is not resumed: only one that
        // is already verified is published; the tasks of the others are merged one by one.
        if (
          op.purpose === 'publication' &&
          !op.localChanges &&
          !['ready', 'applied', 'stale'].includes(op.state)
        ) {
          op.state = 'stale';
          integration.service.save(op);
          await integration.history.notice(
            op,
            'Слияние через отдельного кандидата отменено: каждая задача вливается сама.',
          );
          continue;
        }
        if (dropInheritedMergeChecks(op)) {
          integration.service.save(op);
          await integration.history.notice(
            op,
            'Skaro убрал из проверки слияния сохранённые проверки прежних задач: выполняются проверки проекта и проверки разрешения. Агент слияния продолжит автоматически.',
          );
        }
        if (['preparing', 'resolving', 'verifying'].includes(op.state)) integration.enqueue(op);
        if (op.state === 'ready') {
          if (op.purpose === 'dependencies') ctx.queue.enqueue([`${op.projectId}\n${op.taskId}`]);
          else if (op.publish) integration.enqueue(op);
        }
      } catch (error) {
        op.error = errorText(error);
        op.state = 'failed';
        integration.service.save(op);
        ctx.startup.fail(op.projectId, op.taskId, op.error);
        integration.setRuntime(op, 'failed');
        await integration.history.notice(op, op.error, true);
      }
    }
  await recoverIntegrationStarts(ctx);
}
