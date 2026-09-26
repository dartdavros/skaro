<script lang="ts">
  import { Icon, Select, t, tn } from '@skaro/ui';
  import type { AgentId, RunSlots, TaskAssignment, TaskSummary } from '../../../shared/ipc';
  import { AgentModels, effortLabel } from './agent-models.svelte';
  import Dialog from './Dialog.svelte';
  import { statusLabel } from './model';

  /** "Запустить задачи" (Tasks mockup): agent for all or as in each task, what starts and what waits. */
  let {
    projectId,
    tasks,
    onconfirm,
    onclose,
  }: {
    projectId: string;
    tasks: TaskSummary[];
    onconfirm: (assignment?: TaskAssignment) => void;
    onclose: () => void;
  } = $props();

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
    void models.load(agent, projectId).then(() => (modelId = models.model()?.id ?? ''));
  });

  const startable = (x: TaskSummary) =>
    x.status === 'todo' || x.status === 'failed' || x.status === 'cancelled';
  const runnable = $derived(tasks.filter(startable));
  const blocked = $derived(tasks.some((x) => x.status === 'blocked'));
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
    if (!startable(task)) return { text: statusLabel(task.status), tone: 'queue' };
    return runnable.indexOf(task) < slots.free
      ? { text: t('board.rd.now'), tone: 'now' }
      : { text: t('board.rd.queue'), tone: 'queue' };
  }

  function confirm(): void {
    if (choice === 'task') return onconfirm();
    const effort = models.effort(model);
    onconfirm({
      agent: choice,
      ...(model ? { model: model.id } : {}),
      ...(effort ? { effort } : {}),
    });
  }
</script>

<Dialog width={460} background="var(--sk-fill-13)" radius={12} dim={0.6} {onclose}>
  <div class="head">
    <div class="title">{t('board.rd.title')}</div>
    <div class="sub">
      {tn('board.rd.selected', tasks.length)} · {tn('board.rd.slots', slots.free, {
        total: slots.total,
      })}
    </div>
  </div>

  <div class="fields">
    <div class="row">
      <span class="key">{t('board.rd.agent')}</span>
      <div class="chips">
        {#each [['claude-code', 'Claude Code'], ['codex', 'Codex'], ['task', t('board.rd.asTask')]] as const as [id, label] (id)}
          <button type="button" class="chip" class:on={choice === id} onclick={() => (choice = id)}
            >{label}</button
          >
        {/each}
      </div>
    </div>
    <div class="row">
      <span class="key">{t('board.rd.model')}</span>
      {#if choice === 'task'}
        <div class="static">{t('board.rd.asTask')}</div>
      {:else}
        <div class="select">
          <Select width="100%" label={t('board.rd.model')} {options} bind:value={modelId} />
        </div>
      {/if}
    </div>
  </div>

  <div class="tasks">
    {#each tasks as task (task.id)}
      {@const n = note(task)}
      <div class="task">
        <span class="id">{task.id}</span>
        <span class="name" class:dim={n.tone === 'blocked'}>{task.title}</span>
        <span class="note {n.tone}">
          {#if n.tone === 'blocked'}<Icon name="lock" size={11} stroke={2.1} />{/if}
          {n.text}
        </span>
      </div>
    {/each}
  </div>

  <div class="footer">
    <span class="hint">{blocked ? t('board.rd.hint.blocked') : t('board.rd.hint')}</span>
    <button type="button" class="cancel" onclick={onclose}>{t('ui.cancel')}</button>
    <button type="button" class="confirm" disabled={!runnable.length && !blocked} onclick={confirm}
      >{t('board.rd.action', { n: runnable.length })}</button
    >
  </div>
</Dialog>

<style>
  .head {
    padding: 16px 18px 12px;
  }

  .title {
    font-size: var(--sk-fs-12);
    font-weight: 700;
    color: var(--sk-text-2);
  }

  .sub {
    margin-top: 4px;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-17);
  }

  .fields {
    padding: 0 18px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .key {
    flex: none;
    width: 72px;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-17);
  }

  .chips {
    flex: 1;
    display: flex;
    gap: 6px;
  }

  .chip {
    height: 26px;
    padding: 0 11px;
    border: none;
    border-radius: 7px;
    background: var(--sk-fill-13);
    color: var(--sk-text-10);
    font-size: var(--sk-fs-4);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }

  .chip.on {
    background: var(--sk-accent);
    color: var(--sk-text-1);
  }

  .select {
    flex: 1;
    min-width: 0;
  }

  .static {
    flex: 1;
    height: 32px;
    padding: 0 11px;
    display: flex;
    align-items: center;
    border-radius: 8px;
    background: var(--sk-deep);
    font-size: var(--sk-fs-5);
    color: var(--sk-text-17);
  }

  .tasks {
    margin: 0 18px;
    border-radius: 9px;
    background: var(--sk-deep);
    overflow: hidden;
  }

  .task {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px 12px;
    border-bottom: 1px solid var(--sk-fill-4);
  }

  .id {
    flex: none;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-17);
  }

  .name {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name.dim {
    color: var(--sk-text-17);
  }

  .note {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--sk-fs-3);
    font-weight: 600;
    color: var(--sk-text-17);
  }

  .note.blocked,
  .note.now {
    color: var(--sk-text-13);
  }

  .footer {
    padding: 14px 18px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .hint {
    flex: 1;
    font-size: var(--sk-fs-4);
    color: var(--sk-text-17);
    text-wrap: pretty;
  }

  .cancel,
  .confirm {
    flex: none;
    height: 32px;
    border: none;
    border-radius: 8px;
    font-size: var(--sk-fs-5);
    cursor: pointer;
  }

  .cancel {
    padding: 0 13px;
    background: var(--sk-fill-23);
    color: var(--sk-text-10);
    font-weight: 600;
  }

  .cancel:hover {
    background: var(--sk-fill-29);
    color: var(--sk-text-2);
  }

  .confirm {
    padding: 0 14px;
    background: var(--sk-accent);
    color: var(--sk-text-1);
    font-weight: 700;
  }

  .confirm:hover {
    background: var(--sk-accent-hover);
  }

  .confirm:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
