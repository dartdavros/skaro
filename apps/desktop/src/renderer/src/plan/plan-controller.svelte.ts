import { t } from '@skaro/ui';
import type { MilestoneInfo } from '../../../shared/ipc';
import { archive, relations, stages, type Stage } from './model';
import { createPlanDrag, type PlanDrag } from './plan-drag.svelte';
import type { PlanProps } from './plan-props';

export function createPlanController(getProps: () => PlanProps) {
  const p = $derived(getProps());
  /** "Архив этапов": archived tasks under their milestones instead of the plan. */
  let archiveView = $state(false);
  let openMap = $state<Record<string, boolean> | undefined>();
  let hovered = $state<string | undefined>();
  let modal = $state<{ kind: 'delete'; milestone: MilestoneInfo }>();
  let root = $state<HTMLElement | undefined>();
  let now = $state(Date.now());

  const plan = $derived(stages(p.data.milestones, p.data.tasks, t('plan.loose')));
  const archived = $derived(archive(p.data.milestones, p.data.tasks, t('plan.loose')));
  const list = $derived(archiveView ? archived : plan);
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Read-only lookup rebuilt when tasks change.
  const byId = $derived(new Map(p.data.tasks.map((x) => [x.id, x])));
  const rel = $derived(relations(hovered ? byId.get(hovered) : undefined, p.data.tasks));
  const anyOpen = $derived(list.some((s) => openMap?.[s.milestone.id]));
  const done = $derived(list.reduce((n, s) => n + s.done, 0));
  const total = $derived(list.reduce((n, s) => n + s.total, 0));
  const archiveTip = $derived(
    archiveView ? t('plan.archive.close') : t('plan.archive.open', { n: archived.length }),
  );

  const dnd = createPlanDrag({
    root: () => root,
    stages: () => plan,
    reveal: (id) => (openMap = { ...openMap, [id]: true }),
    ondrop: drop,
  });

  // At first the milestones still in work are open.
  $effect(() => {
    if (openMap || !p.data.loaded) return;
    openMap = Object.fromEntries(
      plan.map((s) => [s.milestone.id, s.total === 0 || s.done < s.total]),
    );
  });

  // The last group restored from the archive brings the plan back.
  $effect(() => {
    if (archiveView && !archived.length) archiveView = false;
  });

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  function toggle(id: string): void {
    openMap = { ...openMap, [id]: !openMap?.[id] };
  }

  function drop(d: PlanDrag): void {
    if (d.kind === 'stage') {
      // "Без этапа" always closes the plan; only milestones are reordered.
      const ids = plan
        .filter((s) => !s.loose && s.milestone.id !== d.id)
        .map((s) => s.milestone.id);
      ids.splice(d.index, 0, d.id);
      void window.skaro.invoke('plan.reorder', p.projectId, ids);
    } else {
      openMap = { ...openMap, [d.to]: true };
      void window.skaro.invoke('plan.placeTask', p.projectId, d.id, d.to, d.index);
    }
  }

  /** "В архив" on the plan, "Вернуть из архива" in the archive: all tasks of the group. */
  function setArchived(stage: Stage, value: boolean): void {
    const ids = stage.tasks.map((x) => x.id);
    void window.skaro.invoke('tasks.archive', p.projectId, ids, value);
  }

  /** Where the stage of a milestone stands. */
  function info(id: string) {
    return p.data.stages.find((s) => s.id === id);
  }

  /** «Запустить» and «Продолжить» start the tasks of the stage in order; «Остановить» ends it. */
  function run(id: string, action: 'run' | 'stop'): void {
    if (action === 'stop') void window.skaro.invoke('stages.stop', p.projectId, id);
    else void window.skaro.invoke('stages.run', p.projectId, id, t('task.start.message'));
  }

  /** «Влить готовое»: the card shows in the feed of the stage. */
  async function mergeFinished(id: string): Promise<void> {
    await window.skaro.invoke('stages.mergeFinished', p.projectId, id);
    p.onopen(id);
  }

  function restoreTask(id: string): void {
    void window.skaro.invoke('tasks.archive', p.projectId, [id], false);
  }

  async function remove(milestone: MilestoneInfo): Promise<void> {
    modal = undefined;
    await window.skaro.invoke('plan.delete', p.projectId, milestone.id);
  }

  return {
    get p() {
      return p;
    },
    get archiveView() {
      return archiveView;
    },
    set archiveView(value: boolean) {
      archiveView = value;
    },
    get openMap() {
      return openMap;
    },
    set openMap(value: typeof openMap) {
      openMap = value;
    },
    get hovered() {
      return hovered;
    },
    set hovered(value: typeof hovered) {
      hovered = value;
    },
    get modal() {
      return modal;
    },
    set modal(value: typeof modal) {
      modal = value;
    },
    get root() {
      return root;
    },
    set root(value: HTMLElement | undefined) {
      root = value;
    },
    get now() {
      return now;
    },
    get plan() {
      return plan;
    },
    get archived() {
      return archived;
    },
    get list() {
      return list;
    },
    get byId() {
      return byId;
    },
    get rel() {
      return rel;
    },
    get anyOpen() {
      return anyOpen;
    },
    get done() {
      return done;
    },
    get total() {
      return total;
    },
    get archiveTip() {
      return archiveTip;
    },
    dnd,
    info,
    run,
    mergeFinished,
    toggle,
    setArchived,
    restoreTask,
    remove,
  };
}

export type PlanController = ReturnType<typeof createPlanController>;
