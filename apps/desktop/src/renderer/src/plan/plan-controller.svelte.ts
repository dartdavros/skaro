import { t } from '@skaro/ui';
import type { MilestoneInfo, MilestoneInput } from '../../../shared/ipc';
import { relations, stages, type Drag, type Over } from './model';
import type { PlanProps } from './plan-props';

export function createPlanController(getProps: () => PlanProps) {
  const p = $derived(getProps());
  let hideDone = $state(false);
  let openMap = $state<Record<string, boolean> | undefined>();
  let hovered = $state<string | undefined>();
  let drag = $state<Drag | undefined>();
  let over = $state<Over | undefined>();
  let modal = $state<{ kind: 'new' } | { kind: 'edit' | 'delete'; milestone: MilestoneInfo }>();
  let now = $state(Date.now());

  const list = $derived(stages(p.data.milestones, p.data.tasks, t('plan.loose')));
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Read-only lookup rebuilt when tasks change.
  const byId = $derived(new Map(p.data.tasks.map((x) => [x.id, x])));
  const rel = $derived(relations(hovered ? byId.get(hovered) : undefined, p.data.tasks));
  const anyOpen = $derived(list.some((s) => openMap?.[s.milestone.id]));
  const done = $derived(list.reduce((n, s) => n + s.done, 0));
  const total = $derived(list.reduce((n, s) => n + s.total, 0));

  // At first the milestones still in work are open.
  $effect(() => {
    if (openMap || !p.data.loaded) return;
    openMap = Object.fromEntries(
      list.map((s) => [s.milestone.id, s.total === 0 || s.done < s.total]),
    );
  });

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  function toggle(id: string): void {
    openMap = { ...openMap, [id]: !openMap?.[id] };
  }

  function drop(): void {
    const d = drag;
    const o = over;
    drag = undefined;
    over = undefined;
    if (!d || !o) return;
    if (d.kind === 'stage' && o.kind === 'stage') {
      // "Без этапа" always closes the plan; only milestones are reordered.
      const ids = list.filter((s) => !s.loose).map((s) => s.milestone.id);
      const from = ids.indexOf(d.id);
      ids.splice(from, 1);
      ids.splice(from < o.index ? o.index - 1 : o.index, 0, d.id);
      void window.skaro.invoke('plan.reorder', p.projectId, ids);
    }
    if (d.kind === 'task' && o.kind === 'task') {
      const from = list.find((s) => s.tasks.some((x) => x.id === d.id));
      const old = from?.tasks.findIndex((x) => x.id === d.id) ?? -1;
      const index = from?.milestone.id === o.stage && old < o.index ? o.index - 1 : o.index;
      openMap = { ...openMap, [o.stage]: true };
      void window.skaro.invoke('plan.placeTask', p.projectId, d.id, o.stage, index);
    }
  }

  async function save(input: MilestoneInput): Promise<void> {
    const m = modal;
    modal = undefined;
    if (m?.kind === 'edit')
      await window.skaro.invoke('plan.update', p.projectId, m.milestone.id, input);
    else {
      const created = await window.skaro.invoke('plan.create', p.projectId, input);
      openMap = { ...openMap, [created.id]: true };
    }
  }

  async function remove(milestone: MilestoneInfo): Promise<void> {
    modal = undefined;
    await window.skaro.invoke('plan.delete', p.projectId, milestone.id);
  }

  return {
    get p() {
      return p;
    },
    get hideDone() {
      return hideDone;
    },
    set hideDone(value: typeof hideDone) {
      hideDone = value;
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
    get drag() {
      return drag;
    },
    set drag(value: typeof drag) {
      drag = value;
    },
    get over() {
      return over;
    },
    set over(value: typeof over) {
      over = value;
    },
    get modal() {
      return modal;
    },
    set modal(value: typeof modal) {
      modal = value;
    },
    get now() {
      return now;
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
    toggle,
    drop,
    save,
    remove,
  };
}

export type PlanController = ReturnType<typeof createPlanController>;
