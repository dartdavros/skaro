<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { MilestoneInfo } from '../../../shared/ipc';

  /** "Удалить этап M02 · Платежи?" (Plan mockup): where its tasks go. */
  let {
    milestone,
    tasks,
    heir,
    onconfirm,
    onclose,
  }: {
    milestone: MilestoneInfo;
    tasks: number;
    heir?: MilestoneInfo;
    onconfirm: () => void;
    onclose: () => void;
  } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="backdrop" role="presentation" onclick={onclose}>
  <div
    class="dialog"
    role="alertdialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={() => undefined}
  >
    <div class="top">
      <span class="badge"><Icon name="trashRound" size={16} stroke={1.9} /></span>
      <div class="texts">
        <span class="title"
          >{t('plan.delete.title', { id: milestone.id, title: milestone.title })}</span
        >
        <span class="text"
          >{tasks && heir
            ? t('plan.delete.moves', { n: tasks, id: heir.id, title: heir.title })
            : t('plan.delete.empty')}</span
        >
      </div>
    </div>
    <div class="footer">
      <button type="button" class="cancel" onclick={onclose}>{t('ui.cancel')}</button>
      <button type="button" class="delete" onclick={onconfirm}>{t('plan.delete.action')}</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: var(--sk-black-a55);
    backdrop-filter: blur(3px);
  }

  .dialog {
    width: 420px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    border-radius: 14px;
    background: var(--sk-fill-11);
    box-shadow:
      0 30px 80px var(--sk-black-a60),
      0 0 0 1px var(--sk-white-a4);
    outline: none;
  }

  .top {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .badge {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--sk-error-a14);
    color: var(--sk-error);
  }

  .texts {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .title {
    font-size: var(--sk-fs-10);
    font-weight: 700;
    color: var(--sk-text-6);
  }

  .text {
    font-size: var(--sk-fs-6);
    line-height: 1.55;
    color: var(--sk-text-19);
    text-wrap: pretty;
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .cancel,
  .delete {
    height: 34px;
    border: none;
    border-radius: 8px;
    font-size: var(--sk-fs-6);
    cursor: pointer;
  }

  .cancel {
    padding: 0 14px;
    background: var(--sk-fill-20);
    color: var(--sk-text-6);
    font-weight: 600;
  }

  .cancel:hover {
    background: var(--sk-fill-27);
    color: var(--sk-text-2);
  }

  .delete {
    padding: 0 15px;
    background: var(--sk-red-6);
    color: var(--sk-text-1);
    font-weight: 700;
  }

  .delete:hover {
    background: var(--sk-red-5);
  }
</style>
