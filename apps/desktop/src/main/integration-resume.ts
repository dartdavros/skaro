import { projectRecords } from './project-records';
import type { TaskRunEngine } from './task-run-engine';
import type { IntegrationOperation } from './integration-model';
import { errorText } from './session-log';
import { recoverIntegrationStarts } from './integration-recovery';
import { recoverLegacyCheckShell } from './integration-shell-recovery';
import { dropInheritedMergeChecks } from './integration-merge-checks';
import { retireIntegration } from './integration-retire';
import { missingLocalScope } from './integration-local-changes';

export async function recoverIntegrations(ctx: TaskRunEngine): Promise<void> {
  const integration = ctx.integrations;
  if (integration.closing) return;
  for await (const project of projectRecords(ctx.deps.db)) {
    const operations = integration.store.all(project.id);
    for (const [index, op] of operations.entries()) {
      if (integration.closing) return;
      if (integration.executing(op.id)) continue;
      // A later candidate of the same task replaced this one, even if it stopped unfinished.
      if (
        !['applied', 'stale'].includes(op.state) &&
        !op.worker &&
        !op.executor &&
        operations
          .slice(index + 1)
          .some((next) => next.taskId === op.taskId && next.purpose === op.purpose)
      ) {
        op.state = 'stale';
        integration.service.save(op);
      }
      if (['applied', 'stale'].includes(op.state) && !op.worker && !op.executor) {
        await retireIntegration(ctx, op);
        continue;
      }
      try {
        await ctx.processes.stop(`verification-${op.id}`);
        if (op.worker) {
          await ctx.processes.stop(op.worker);
          op.worker = undefined;
          integration.service.save(op);
        }
        op.executor = undefined;
        integration.service.save(op);
        // Its tasks went into the base another way (by hand, or by a publication this record
        // missed): nothing is left to merge, so the agent is not started again.
        if (op.purpose === 'publication' && (await published(ctx, op))) {
          op.state = 'stale';
          integration.service.save(op);
          await integration.history.notice(
            op,
            'Задача уже влита в основную ветку. Skaro закрыл это слияние.',
          );
          await retireIntegration(ctx, op);
          continue;
        }
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
        const missing = await missingLocalScope(ctx.project(op.projectId), op);
        if (missing.length) {
          await integration.history.notice(
            op,
            `Skaro добавляет в слияние ваши незакоммиченные правки из тех же папок (${missing.join(', ')}) и начинает слияние заново вместе с ними.`,
          );
          void ctx.merges.coordinator
            .rescopeCandidate(op, missing)
            .catch((error: unknown) =>
              console.error(`integration ${op.id} rescope: ${errorText(error)}`),
            );
          continue;
        }
        if (dropInheritedMergeChecks(op)) {
          integration.service.save(op);
          await integration.history.notice(
            op,
            'Skaro убрал из проверки слияния сохранённые проверки прежних задач: выполняются проверки проекта и проверки разрешения. Skaro продолжит проверку слияния автоматически.',
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
  }
  await recoverIntegrationStarts(ctx);
}

async function published(ctx: TaskRunEngine, op: IntegrationOperation): Promise<boolean> {
  const context = ctx.project(op.projectId);
  context.invalidate();
  const tasks = (await context.load()).tasks;
  return op.results.every(
    (result) => tasks.find((task) => task.id === result.taskId)?.status === 'done',
  );
}
