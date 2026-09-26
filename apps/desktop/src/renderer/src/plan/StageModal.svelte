<script lang="ts">
  import { Modal, t } from '@skaro/ui';
  import type { MilestoneInfo, MilestoneInput } from '../../../shared/ipc';

  /** "Новый этап" / "Этап M02" (Plan mockup): title, goal, done criterion. */
  let {
    milestone,
    onsave,
    onclose,
  }: {
    /** The milestone being edited; a new one when absent. */
    milestone?: MilestoneInfo;
    onsave: (input: MilestoneInput) => void;
    onclose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let form = $state<MilestoneInput>({
    title: milestone?.title ?? '',
    goal: milestone?.goal ?? '',
    criteria: milestone?.criteria ?? '',
  });
  let open = $state(true);
  const ok = $derived(form.title.trim().length > 0);

  $effect(() => {
    if (!open) onclose();
  });
</script>

<Modal
  bind:open
  width={460}
  title={milestone ? t('plan.modal.edit', { id: milestone.id }) : t('plan.modal.new')}
>
  <label class="field">
    <span class="label">{t('plan.modal.name')}</span>
    <!-- svelte-ignore a11y_autofocus -->
    <input type="text" autofocus bind:value={form.title} placeholder={t('plan.modal.name.ph')} />
  </label>
  <label class="field">
    <span class="label">{t('plan.goal')}</span>
    <textarea rows="2" bind:value={form.goal} placeholder={t('plan.modal.goal.ph')}></textarea>
  </label>
  <label class="field">
    <span class="label">{t('plan.criteria')}</span>
    <textarea rows="2" bind:value={form.criteria} placeholder={t('plan.modal.criteria.ph')}
    ></textarea>
  </label>
  {#snippet footer()}
    <button type="button" class="cancel" onclick={onclose}>{t('ui.cancel')}</button>
    <button type="button" class="save" class:ok disabled={!ok} onclick={() => onsave(form)}
      >{milestone ? t('plan.modal.save') : t('plan.modal.create')}</button
    >
  {/snippet}
</Modal>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .label {
    font-size: var(--sk-fs-2);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--sk-text-23);
  }

  input,
  textarea {
    border: none;
    border-radius: 8px;
    background: var(--sk-fill-3);
    color: var(--sk-text-2);
    font-size: var(--sk-fs-6);
    outline: none;
  }

  input {
    height: 34px;
    padding: 0 11px;
    box-shadow: inset 0 0 0 1px var(--sk-fill-25);
  }

  input:hover {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px var(--sk-fill-31);
  }

  textarea {
    padding: 9px 11px;
    line-height: 1.5;
    resize: none;
  }

  textarea:hover {
    background: var(--sk-field-hover);
  }

  input:focus,
  textarea:focus {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px var(--sk-accent);
  }

  .cancel,
  .save {
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

  .save {
    padding: 0 15px;
    background: var(--sk-fill-26);
    color: var(--sk-text-23);
    font-weight: 700;
    cursor: default;
  }

  .save.ok {
    background: var(--sk-accent);
    color: var(--sk-text-1);
    cursor: pointer;
  }

  .save.ok:hover {
    background: var(--sk-accent-hover);
  }
</style>
