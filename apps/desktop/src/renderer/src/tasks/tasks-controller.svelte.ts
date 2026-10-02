import { t, tn } from '@skaro/ui';
import type { TaskAssignment } from '../../../shared/ipc';
import { applyFilters, needsYou, type BulkAction, type Filters } from './model';
import type { TasksProps } from './tasks-props';

export function createTasksController(p: TasksProps) {
  let view = $state<'board' | 'list'>('board');
  let filters = $state<Filters>({ query: '', milestones: [], statuses: [], agents: [] });
  let selected = $state<string[]>([]);
  let dialog = $state<BulkAction | undefined>();
  let now = $state(Date.now());

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    void window.skaro
      .invoke('app.getSetting', `tasks.${p.projectId}.view`)
      .then((v) => (view = v === 'list' ? 'list' : 'board'));
  });

  const all = $derived(p.data.tasks.filter((x) => !x.archived));
  const shown = $derived(applyFilters(all, filters));
  const picked = $derived(all.filter((x) => selected.includes(x.id)));
  const subtitle = $derived(
    [
      tn('board.count', all.length),
      tn('board.running', all.filter((x) => x.status === 'in_progress').length),
      tn('board.waiting', all.filter(needsYou).length),
    ].join(' · '),
  );

  // Tasks that left the board (deleted, archived) leave the selection too.
  $effect(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Local membership index, rebuilt on every effect.
    const ids = new Set(all.map((x) => x.id));
    if (selected.some((id) => !ids.has(id))) selected = selected.filter((id) => ids.has(id));
  });

  function setView(next: 'board' | 'list'): void {
    view = next;
    void window.skaro.invoke('app.setSetting', `tasks.${p.projectId}.view`, next);
  }

  function select(id: string, on: boolean): void {
    selected = on ? [...selected, id] : selected.filter((x) => x !== id);
  }

  async function act(run: () => Promise<unknown>): Promise<void> {
    dialog = undefined;
    await run().catch(() => undefined);
  }

  const ids = () => $state.snapshot(selected);

  function bulk(milestone?: string): Promise<void> {
    const kind = dialog;
    return act(async () => {
      if (kind === 'delete') await window.skaro.invoke('tasks.delete', p.projectId, ids());
      if (kind === 'archive') await window.skaro.invoke('tasks.archive', p.projectId, ids(), true);
      if (kind === 'unblock') await window.skaro.invoke('tasks.unblock', p.projectId, ids());
      if (kind === 'move' && milestone)
        await window.skaro.invoke('tasks.move', p.projectId, ids(), milestone);
      if (kind === 'delete' || kind === 'archive') selected = [];
    });
  }

  function run(assignment?: TaskAssignment): Promise<void> {
    return act(async () => {
      await window.skaro.invoke(
        'tasks.run',
        p.projectId,
        ids(),
        t('task.start.message'),
        ...(assignment ? [assignment] : []),
      );
      selected = [];
    });
  }

  function assign(assignment: TaskAssignment): Promise<void> {
    return act(() => window.skaro.invoke('tasks.assign', p.projectId, ids(), assignment));
  }

  return {
    p,
    get view() {
      return view;
    },
    set view(value: typeof view) {
      view = value;
    },
    get filters() {
      return filters;
    },
    set filters(value: typeof filters) {
      filters = value;
    },
    get selected() {
      return selected;
    },
    set selected(value: typeof selected) {
      selected = value;
    },
    get dialog() {
      return dialog;
    },
    set dialog(value: typeof dialog) {
      dialog = value;
    },
    get now() {
      return now;
    },
    get all() {
      return all;
    },
    get shown() {
      return shown;
    },
    get picked() {
      return picked;
    },
    get subtitle() {
      return subtitle;
    },
    setView,
    select,
    bulk,
    run,
    assign,
  };
}

export type TasksController = ReturnType<typeof createTasksController>;
