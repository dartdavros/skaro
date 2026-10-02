<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { QuestionController } from './question-controller.svelte';
  let { model }: { model: QuestionController } = $props();
</script>

<div class="head">
  <span class="fd-label" style="flex: 1">{model.q.header}</span>
  {#if model.questions.length > 1}
    <span class="step"
      >{t('card.question.step', { i: model.step + 1, n: model.questions.length })}</span
    >
    <button
      type="button"
      class="nav"
      disabled={model.step === 0}
      data-tip={t('card.question.prev')}
      aria-label={t('card.question.prev')}
      onclick={() => (model.step -= 1)}
    >
      <Icon name="chevronLeft" size={12} stroke={2.4} />
    </button>
    <button
      type="button"
      class="nav"
      disabled={model.step >= model.questions.length - 1}
      data-tip={t('card.question.next')}
      aria-label={t('card.question.next')}
      onclick={() => (model.step += 1)}
    >
      <Icon name="chevronRight" size={12} stroke={2.4} />
    </button>
  {/if}
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 22px;
  }

  .step {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-19);
  }

  .nav {
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--sk-text-13);
    cursor: pointer;
    padding: 0;
  }

  .nav:hover:not(:disabled) {
    background: var(--sk-fill-20);
  }

  .nav:disabled {
    color: var(--sk-text-29);
    cursor: default;
  }
</style>
