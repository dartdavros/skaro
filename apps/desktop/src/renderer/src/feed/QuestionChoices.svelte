<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { QuestionController } from './question-controller.svelte';
  let { model }: { model: QuestionController } = $props();

  /**
   * Numbered options as in Claude Code: the number is the key that picks it, "Свой вариант…"
   * is the last numbered row with its own field.
   */
  const custom = $derived(model.q.allowFreeText || !model.q.options.length);
  const customOn = $derived(!!model.customOn[model.q.id] || !model.q.options.length);
  let field: HTMLInputElement | undefined = $state();

  function pickCustom(): void {
    if (!model.customOn[model.q.id]) model.toggleCustom();
    field?.focus();
  }
</script>

<div class="options" role={model.q.multi ? 'group' : 'radiogroup'}>
  {#each model.q.options as option, i (option.label)}
    {@const on = (model.picked[model.q.id] ?? []).includes(option.label)}
    <button
      type="button"
      class="option"
      class:on
      role={model.q.multi ? 'checkbox' : 'radio'}
      aria-checked={on}
      onclick={() => model.choose(option.label)}
    >
      <span class="key">
        {#if on && model.q.multi}<Icon name="check" size={11} stroke={3} />{:else}{i + 1}{/if}
      </span>
      <span class="texts">
        <span class="title">{option.label}</span>
        {#if option.description}<span class="note">{option.description}</span>{/if}
      </span>
      {#if on && !model.q.multi}
        <span class="picked"><Icon name="check" size={14} stroke={2.6} /></span>
      {/if}
    </button>
  {/each}
  {#if custom}
    <div
      class="option custom"
      class:on={customOn && !!model.custom[model.q.id]?.trim()}
      role="presentation"
      onclick={pickCustom}
    >
      <span class="key">{model.q.options.length + 1}</span>
      <input
        bind:this={field}
        class="field"
        placeholder={t('card.question.custom')}
        aria-label={t('card.question.custom')}
        bind:value={model.custom[model.q.id]}
        oninput={model.customInput}
      />
    </div>
  {/if}
</div>

<style>
  .options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .option {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    width: 100%;
    padding: 10px 12px 10px 10px;
    border: none;
    border-radius: 9px;
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--sk-fill-18);
    text-align: left;
    font-family: inherit;
    cursor: pointer;
    transition:
      background 0.12s,
      box-shadow 0.12s;
  }

  .option:hover {
    background: var(--sk-surface-2);
    box-shadow: inset 0 0 0 1px var(--sk-fill-25);
  }

  .option:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1.5px var(--sk-accent);
  }

  .option.on {
    background: var(--sk-accent-a14);
    box-shadow: inset 0 0 0 1px var(--sk-accent-a55);
  }

  .key {
    flex: none;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: var(--sk-fill-20);
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-2);
    color: var(--sk-text-17);
  }

  .option.on .key {
    background: var(--sk-accent);
    color: var(--sk-text-1);
  }

  .texts {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-top: 1px;
  }

  .title {
    font-size: var(--sk-fs-5);
    font-weight: 600;
    line-height: 1.35;
    color: var(--sk-text-10);
  }

  .option.on .title {
    color: var(--sk-text-5);
  }

  .note {
    font-size: var(--sk-fs-3);
    line-height: 1.45;
    color: var(--sk-text-21);
    text-wrap: pretty;
  }

  .picked {
    flex: none;
    display: inline-flex;
    padding-top: 3px;
    color: var(--sk-accent);
  }

  .custom {
    align-items: center;
    cursor: text;
  }

  .custom:focus-within {
    box-shadow: inset 0 0 0 1px var(--sk-accent-a55);
  }

  .field {
    flex: 1;
    min-width: 0;
    height: 20px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--sk-text-2);
    font-family: inherit;
    font-size: var(--sk-fs-5);
    outline: none;
  }

  .field::placeholder {
    color: var(--sk-text-23);
  }
</style>
