<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { QuestionController } from './question-controller.svelte';
  let { model }: { model: QuestionController } = $props();
</script>

<div class="options">
  {#each model.q.options as option (option.label)}
    {@const on = (model.picked[model.q.id] ?? []).includes(option.label)}
    <button type="button" class="fd-option" class:on onclick={() => model.choose(option.label)}>
      {#if model.q.multi}
        <span class="fd-check"><Icon name="check" size={11} stroke={3.2} /></span>
      {:else}
        <span class="fd-radio"></span>
      {/if}
      <span class="texts">
        <span class="title">{option.label}</span>
        {#if option.description}<span class="note">{option.description}</span>{/if}
      </span>
    </button>
  {/each}
  {#if model.q.allowFreeText || !model.q.options.length}
    <div class="custom" class:on={model.customOn[model.q.id] || !model.q.options.length}>
      {#if model.q.options.length}
        <button
          type="button"
          class="custom-mark"
          aria-label={t('card.question.custom')}
          onclick={model.toggleCustom}
        >
          {#if model.q.multi}
            <span class="fd-check" class:on={model.customOn[model.q.id]}
              ><Icon name="check" size={11} stroke={3.2} /></span
            >
          {:else}
            <span class="fd-radio" class:on={model.customOn[model.q.id]}></span>
          {/if}
        </button>
      {/if}
      <input
        class="fd-input"
        style="height: 30px"
        placeholder={t('card.question.custom')}
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
    gap: 4px;
  }

  .custom {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 8px;
  }

  .custom.on {
    background: var(--sk-bg);
  }

  .custom-mark {
    flex: none;
    display: inline-flex;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }

  .custom-mark .fd-radio,
  .custom-mark .fd-check {
    margin-top: 0;
  }
</style>
