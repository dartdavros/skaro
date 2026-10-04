<script lang="ts">
  import { Modal, t } from '@skaro/ui';

  /** "Новая спецификация" (Documents mockup): only the title; Skaro gives the file and the number. */
  let {
    next,
    oncreate,
    onclose,
  }: {
    /** Number the specification gets: "SPEC-0004". */
    next: string;
    oncreate: (title: string) => void;
    onclose: () => void;
  } = $props();

  let open = $state(true);
  let title = $state('');
  const ok = $derived(title.trim() !== '');

  $effect(() => {
    if (!open) onclose();
  });

  function create(): void {
    if (ok) oncreate(title.trim());
  }
</script>

<Modal bind:open width={420} title={t('docs.newSpec')}>
  <div class="field">
    <span class="label">{t('docs.newSpec.title')}</span>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="text"
      autofocus
      bind:value={title}
      placeholder={t('docs.newSpec.placeholder')}
      onkeydown={(e) => e.key === 'Enter' && create()}
    />
    <span class="note">{t('docs.newSpec.note')} <span class="code">{next}</span></span>
  </div>
  {#snippet footer()}
    <button type="button" class="cancel" onclick={onclose}>{t('ui.cancel')}</button>
    <button type="button" class="create" class:ok disabled={!ok} onclick={create}
      >{t('docs.newDoc.create')}</button
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

  input {
    width: 100%;
    height: 34px;
    padding: 0 11px;
    border: none;
    border-radius: 8px;
    background: var(--sk-fill-3);
    color: var(--sk-text-2);
    font-size: var(--sk-fs-6);
    outline: none;
    box-shadow: inset 0 0 0 1px var(--sk-fill-25);
  }

  input:hover {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px var(--sk-fill-31);
  }

  input:focus {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px var(--sk-accent);
  }

  .note {
    font-size: var(--sk-fs-4);
    color: var(--sk-text-23);
  }

  .code {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-19);
  }

  .cancel,
  .create {
    height: 34px;
    border: none;
    border-radius: 8px;
    font-size: var(--sk-fs-6);
  }

  .cancel {
    padding: 0 14px;
    background: var(--sk-fill-20);
    color: var(--sk-text-6);
    font-weight: 600;
    cursor: pointer;
  }

  .cancel:hover {
    background: var(--sk-fill-27);
    color: var(--sk-text-2);
  }

  .create {
    padding: 0 15px;
    background: var(--sk-fill-20);
    color: var(--sk-text-23);
    font-weight: 700;
    cursor: default;
  }

  .create.ok {
    background: var(--sk-accent);
    color: var(--sk-text-1);
    cursor: pointer;
  }

  .create.ok:hover {
    background: var(--sk-accent-hover);
  }
</style>
