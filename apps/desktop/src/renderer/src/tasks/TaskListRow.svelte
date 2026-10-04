<script lang="ts">
  import { AgentLogo, Checkbox, t } from '@skaro/ui';
  import type { TaskSummary } from '../../../shared/ipc';
  import { agoLong } from '../ago';
  import { agentLine, boardStatus } from './model';
  import StatusLabel from './StatusLabel.svelte';
  let {
    task,
    on,
    selecting,
    now,
    onselect,
    onopen,
  }: {
    task: TaskSummary;
    on: boolean;
    selecting: boolean;
    now: number;
    onselect: (id: string, on: boolean) => void;
    onopen: (id: string) => void;
  } = $props();
  const kind = $derived(boardStatus(task.status));
  const pickTip = $derived(on ? t('board.unselect') : t('board.select'));

  function activate(): void {
    if (selecting) onselect(task.id, !on);
    else onopen(task.id);
  }
</script>

<div
  data-task-list
  class="grid row"
  class:selected={on}
  class:dim={kind === 'blocked'}
  role="button"
  tabindex="0"
  data-tip={selecting ? pickTip : t('board.open')}
  onclick={activate}
  onkeydown={(e) => e.key === 'Enter' && e.target === e.currentTarget && activate()}
>
  {#if selecting}
    <span data-task-list class="check">
      <Checkbox checked={on} tip={pickTip} onchange={(v) => onselect(task.id, v)} />
    </span>
  {/if}
  <span data-task-list class="id">{task.id}</span>
  <span
    data-task-list
    class="title"
    class:muted={kind === 'blocked' || kind === 'done' || kind === 'cancelled'}>{task.title}</span
  >
  <StatusLabel status={task.status} />
  <span data-task-list class="agent">
    {#if task.agent}<AgentLogo agent={task.agent} size={10} />{/if}
    <span data-task-list class="agent-name">{agentLine(task)}</span>
  </span>
  <span data-task-list class="deps" class:has={task.deps.length > 0}
    >{task.deps.length ? `← ${task.deps.join(', ')}` : '—'}</span
  >
  <span data-task-list class="updated"
    >{task.status === 'in_progress' ? t('agoShort.now') : agoLong(task.updatedAt, now)}</span
  >
</div>
