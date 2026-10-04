<script lang="ts">
  import { Icon, Select, t, tn } from '@skaro/ui';
  import Dialog from './Dialog.svelte';
  import type { RunProps } from './run-props';
  import { createRunController } from './run-controller.svelte';
  let { projectId, tasks, onconfirm, onclose }: RunProps = $props();
  const state = createRunController({
    get projectId() {
      return projectId;
    },
    get tasks() {
      return tasks;
    },
    get onconfirm() {
      return onconfirm;
    },
    get onclose() {
      return onclose;
    },
  });

  import './run-dialog.css';
</script>

<Dialog width={460} background="var(--sk-fill-13)" radius={12} dim={0.6} {onclose}>
  <div data-task-run-dialog class="head">
    <div data-task-run-dialog class="title">{t('board.rd.title')}</div>
    <div data-task-run-dialog class="sub">
      {tn('board.rd.selected', tasks.length)} · {tn('board.rd.slots', state.slots.free, {
        total: state.slots.total,
      })}
    </div>
  </div>

  <div data-task-run-dialog class="fields">
    <div data-task-run-dialog class="row">
      <span data-task-run-dialog class="key">{t('board.rd.agent')}</span>
      <div data-task-run-dialog class="chips">
        {#each [['claude-code', 'Claude Code'], ['codex', 'Codex'], ['task', t('board.rd.asTask')]] as const as [id, label] (id)}
          <button
            data-task-run-dialog
            type="button"
            class="chip"
            class:on={state.choice === id}
            onclick={() => (state.choice = id)}>{label}</button
          >
        {/each}
      </div>
    </div>
    <div data-task-run-dialog class="row">
      <span data-task-run-dialog class="key">{t('board.rd.model')}</span>
      {#if state.choice === 'task'}
        <div data-task-run-dialog class="static">{t('board.rd.asTask')}</div>
      {:else}
        <div data-task-run-dialog class="select">
          <Select
            width="100%"
            label={t('board.rd.model')}
            options={state.options}
            bind:value={state.modelId}
          />
        </div>
      {/if}
    </div>
  </div>

  <div data-task-run-dialog class="tasks">
    {#each tasks as task (task.id)}
      {@const n = state.note(task)}
      <div data-task-run-dialog class="task">
        <span data-task-run-dialog class="id">{task.id}</span>
        <span data-task-run-dialog class="name" class:dim={n.tone === 'blocked'}>{task.title}</span>
        <span data-task-run-dialog class="note {n.tone}">
          {#if n.tone === 'blocked'}<Icon name="lock" size={11} stroke={2.1} />{/if}
          {#if n.tone === 'stage'}<Icon name="clock" size={11} stroke={2.1} />{/if}
          {n.text}
        </span>
      </div>
    {/each}
  </div>

  <div data-task-run-dialog class="footer">
    <span data-task-run-dialog class="hint"
      >{state.blocked
        ? t('board.rd.hint.blocked')
        : tasks.some((x) => x.staged)
          ? t('board.rd.hint.stage')
          : t('board.rd.hint')}</span
    >
    <button data-task-run-dialog type="button" class="cancel" onclick={onclose}
      >{t('ui.cancel')}</button
    >
    <button
      data-task-run-dialog
      type="button"
      class="confirm"
      disabled={!state.runnable.length && !state.blocked}
      onclick={state.confirm}>{t('board.rd.action', { n: state.runnable.length })}</button
    >
  </div>
</Dialog>
