<script lang="ts">
  import type { Interaction } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import { createQuestionController } from './question-controller.svelte';
  import QuestionHeader from './QuestionHeader.svelte';
  import QuestionChoices from './QuestionChoices.svelte';
  import QuestionSecret from './QuestionSecret.svelte';

  let { interaction }: { interaction: Extract<Interaction, { kind: 'question' }> } = $props();
  const model = createQuestionController(() => interaction);
</script>

<div class="fd-card">
  <QuestionHeader {model} />
  <div class="fd-card-q">{model.q.text}</div>

  {#if model.q.secret}
    <QuestionSecret {model} />
  {:else}
    <QuestionChoices {model} />
  {/if}

  {#if model.preview}
    <pre class="preview">{model.preview}</pre>
  {/if}

  <div class="fd-card-foot">
    <span class="hint">{t('card.question.hint')}</span>
    <button
      type="button"
      class="fd-btn primary"
      disabled={!model.ready || model.sending}
      data-tip={model.ready ? t('card.question.answerTip') : t('card.question.notReady')}
      onclick={() => void model.send()}>{t('card.question.answer')}</button
    >
  </div>
</div>

<style>
  .preview {
    margin: 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--sk-fill-3);
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    line-height: 1.5;
    color: var(--sk-text-13);
    white-space: pre-wrap;
    max-height: 220px;
    overflow: auto;
  }
</style>
