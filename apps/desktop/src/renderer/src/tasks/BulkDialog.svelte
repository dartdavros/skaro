<script lang="ts">
  import { Icon, t, tn, type IconName } from '@skaro/ui';
  import type { MilestoneInfo, TaskSummary } from '../../../shared/ipc';
  import Dialog from './Dialog.svelte';
  import { statusLabel, type BulkKind } from './model';

  /** Confirmation of a bulk action with the list of tasks it touches (Tasks mockup). */
  let {
    kind,
    tasks,
    milestones,
    onconfirm,
    onclose,
  }: {
    kind: BulkKind;
    tasks: TaskSummary[];
    milestones: MilestoneInfo[];
    /** `milestone` — the target of "Перенести". */
    onconfirm: (milestone?: string) => void;
    onclose: () => void;
  } = $props();

  const LOOK: Record<BulkKind, { icon: IconName; bg: string; color: string; btn: string }> = {
    delete: {
      icon: 'trashLines',
      bg: 'var(--sk-red-8)',
      color: 'var(--sk-error)',
      btn: 'var(--sk-red-7)',
    },
    archive: {
      icon: 'archive',
      bg: 'var(--sk-fill-20)',
      color: 'var(--sk-text-11)',
      btn: 'var(--sk-accent)',
    },
    move: {
      icon: 'folderPlus',
      bg: 'var(--sk-fill-20)',
      color: 'var(--sk-text-11)',
      btn: 'var(--sk-accent)',
    },
    unblock: {
      icon: 'unlock',
      bg: 'var(--sk-orange-3)',
      color: 'var(--sk-orange-1)',
      btn: 'var(--sk-accent)',
    },
  };

  const shown = $derived(kind === 'unblock' ? tasks.filter((x) => x.status === 'blocked') : tasks);
  const title = $derived(
    kind === 'unblock'
      ? t('board.dlg.unblock', { n: shown.length })
      : tn(`board.dlg.${kind}`, tasks.length),
  );
  const action = $derived(kind === 'unblock' ? t('board.unblock') : t(`board.dlg.${kind}.action`));
  const look = $derived(LOOK[kind]);
  // svelte-ignore state_referenced_locally
  let target = $state(milestones.at(-1)?.id ?? '');

  function note(task: TaskSummary): string {
    if (kind === 'move') return task.milestone?.id ?? '—';
    if (task.status === 'blocked') return t('board.waits', { deps: task.waitsFor.join(', ') });
    return statusLabel(task.status);
  }
</script>

<Dialog width={428} {onclose}>
  <div class="top">
    <span class="badge" style="background: {look.bg}; color: {look.color}"
      ><Icon name={look.icon} size={17} stroke={1.9} /></span
    >
    <div class="texts">
      <div class="title">{title}</div>
      <div class="text">{t(`board.dlg.${kind}.text`)}</div>
    </div>
  </div>

  <div class="tasks">
    {#each shown as task (task.id)}
      <div class="task">
        <span class="id">{task.id}</span>
        <span class="name">{task.title}</span>
        <span class="note" class:blocked={task.status === 'blocked'}>{note(task)}</span>
      </div>
    {/each}
  </div>

  {#if kind === 'move'}
    <div class="targets">
      <span class="label">{t('board.move')}</span>
      {#each milestones as m (m.id)}
        <div
          class="target"
          class:on={target === m.id}
          role="radio"
          aria-checked={target === m.id}
          tabindex="0"
          onclick={() => (target = m.id)}
          onkeydown={(e) => e.key === 'Enter' && (target = m.id)}
        >
          <span class="radio"></span>
          <span class="id">{m.id}</span>
          <span class="name">{m.title}</span>
        </div>
      {/each}
    </div>
  {/if}

  <div class="footer">
    <span class="hint">{t(`board.dlg.${kind}.hint`)}</span>
    <button type="button" class="cancel" onclick={onclose}>{t('ui.cancel')}</button>
    <button
      type="button"
      class="confirm"
      style="background: {look.btn}"
      disabled={kind === 'move' && !target}
      onclick={() => onconfirm(kind === 'move' ? target : undefined)}>{action}</button
    >
  </div>
</Dialog>

<style>
  .top {
    display: flex;
    align-items: flex-start;
    gap: 13px;
    padding: 18px 20px 14px;
  }

  .badge {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .texts {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .title {
    font-size: var(--sk-fs-11);
    font-weight: 700;
    color: var(--sk-text-2);
  }

  .text {
    font-size: var(--sk-fs-5);
    line-height: 1.55;
    color: var(--sk-text-17);
    text-wrap: pretty;
  }

  .tasks {
    margin: 0 20px;
    border-radius: 9px;
    background: var(--sk-fill-3);
    max-height: 148px;
    overflow-y: auto;
  }

  .task {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--sk-fill-5);
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

  .note {
    flex: none;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
  }

  .note.blocked {
    color: var(--sk-text-13);
  }

  .targets {
    padding: 14px 20px 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .label {
    font-size: var(--sk-fs-2);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sk-text-21);
  }

  .target {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 11px;
    border-radius: 8px;
    background: var(--sk-fill-10);
    cursor: pointer;
    outline: none;
  }

  .target:hover {
    background: var(--sk-fill-15);
  }

  .target.on {
    background: var(--sk-fill-20);
  }

  .radio {
    flex: none;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--sk-fill-34);
  }

  .target.on .radio {
    background: var(--sk-accent);
    box-shadow: inset 0 0 0 1.5px var(--sk-accent);
  }

  .footer {
    padding: 16px 20px 18px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .hint {
    flex: 1;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
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
    padding: 0 15px;
    color: var(--sk-text-1);
    font-weight: 700;
  }

  .confirm:hover {
    opacity: 0.88;
  }

  .confirm:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
