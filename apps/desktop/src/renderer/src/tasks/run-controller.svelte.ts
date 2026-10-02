import { t } from '@skaro/ui';
import type { AgentId, RunSlots, TaskSummary } from '../../../shared/ipc';
import { AgentModels, effortLabel } from './agent-models.svelte';
import { canStart, statusLabel } from './model';
import type { RunProps } from './run-props';

export function createRunController(p: RunProps) {
  let choice = $state<AgentId | 'task'>('claude-code');
  let modelId = $state('');
  let slots = $state<RunSlots>({ total: 3, free: 3 });
  const models = new AgentModels();

  $effect(() => {
    void window.skaro.invoke('tasks.slots').then((s) => (slots = s));
  });

  $effect(() => {
    const agent = choice;
    if (agent === 'task') return;
    void models.load(agent, p.projectId).then(() => (modelId = models.model()?.id ?? ''));
  });

  const runnable = $derived(p.tasks.filter(canStart));
  const blocked = $derived(p.tasks.some((x) => x.status === 'blocked'));
  const model = $derived(models.model(modelId));
  const options = $derived(
    models.list.map((m) => {
      const effort = models.effort(m);
      return {
        value: m.id,
        label: effort ? `${m.name} · ${effortLabel(effort).toLowerCase()}` : m.name,
      };
    }),
  );

  function note(task: TaskSummary): { text: string; tone: 'blocked' | 'now' | 'queue' } {
    if (task.status === 'blocked') {
      return { text: t('board.waits', { deps: task.waitsFor.join(', ') }), tone: 'blocked' };
    }
    if (!canStart(task)) return { text: statusLabel(task.status), tone: 'queue' };
    return runnable.indexOf(task) < slots.free
      ? { text: t('board.rd.now'), tone: 'now' }
      : { text: t('board.rd.queue'), tone: 'queue' };
  }

  function confirm(): void {
    if (choice === 'task') return p.onconfirm();
    const effort = models.effort(model);
    p.onconfirm({
      agent: choice,
      ...(model ? { model: model.id } : {}),
      ...(effort ? { effort } : {}),
    });
  }

  return {
    p,
    get choice() {
      return choice;
    },
    set choice(value: typeof choice) {
      choice = value;
    },
    get modelId() {
      return modelId;
    },
    set modelId(value: typeof modelId) {
      modelId = value;
    },
    get slots() {
      return slots;
    },
    get runnable() {
      return runnable;
    },
    get blocked() {
      return blocked;
    },
    get options() {
      return options;
    },
    note,
    confirm,
  };
}

export type RunController = ReturnType<typeof createRunController>;
