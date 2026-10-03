<script lang="ts">
  import type { Interaction } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import { createQuestionController } from './question-controller.svelte';
  import QuestionHeader from './QuestionHeader.svelte';
  import QuestionChoices from './QuestionChoices.svelte';
  import QuestionSecret from './QuestionSecret.svelte';

  let { interaction }: { interaction: Extract<Interaction, { kind: 'question' }> } = $props();
  const model = createQuestionController(() => interaction);

  /** Digits pick an option, as in Claude Code; the one after the options goes to "Свой вариант…". */
  function keys(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (model.q.secret || target.closest('input, textarea') || e.ctrlKey || e.metaKey || e.altKey)
      return;
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1) return;
    const option = model.q.options[n - 1];
    if (option) model.choose(option.label);
    else if (n === model.q.options.length + 1)
      (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>('.field')?.focus();
    else return;
    e.preventDefault();
  }
</script>

<div class="fd-card question" role="presentation" onkeydown={keys}>
  <QuestionHeader {model} />
  <div class="text">{model.q.text}</div>

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
  .question {
    gap: 14px;
    padding: 15px 16px 14px;
    border-radius: 12px;
    box-shadow: inset 0 0 0 1px var(--sk-fill-18);
  }

  .text {
    font-size: var(--sk-fs-8);
    font-weight: 600;
    line-height: 1.45;
    color: var(--sk-text-5);
    text-wrap: pretty;
  }

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
