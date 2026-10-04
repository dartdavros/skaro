<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { QuestionController } from './question-controller.svelte';
  let { model }: { model: QuestionController } = $props();
</script>

<!-- Several questions: tabs as in Claude Code, an answered one is checked. -->
{#if model.questions.length > 1}
  <div class="tabs" role="tablist">
    {#each model.questions as question, i (question.id)}
      {@const done = model.answered(question.id)}
      <button
        type="button"
        class="tab"
        class:active={i === model.step}
        class:done
        role="tab"
        aria-selected={i === model.step}
        data-tip={t('card.question.step', { i: i + 1, n: model.questions.length })}
        onclick={() => (model.step = i)}
      >
        <span class="mark">
          {#if done}<Icon name="check" size={11} stroke={3} />{:else}{i + 1}{/if}
        </span>
        <span class="name">{question.header || i + 1}</span>
      </button>
    {/each}
  </div>
{:else if model.q.header}
  <span class="fd-label">{model.q.header}</span>
{/if}

<style>
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 26px;
    max-width: 220px;
    padding: 0 10px 0 5px;
    border: none;
    border-radius: 7px;
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--sk-fill-22);
    color: var(--sk-text-19);
    font-family: inherit;
    font-size: var(--sk-fs-3);
    font-weight: 600;
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s,
      box-shadow 0.12s;
  }

  .tab:hover {
    background: var(--sk-surface-2);
    color: var(--sk-text-6);
  }

  .tab.active {
    background: var(--sk-fill-20);
    box-shadow: inset 0 0 0 1px var(--sk-fill-30);
    color: var(--sk-text-5);
  }

  .mark {
    flex: none;
    width: 17px;
    height: 17px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    background: var(--sk-fill-20);
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-0);
    color: var(--sk-text-17);
  }

  .tab.active .mark {
    background: var(--sk-fill-28);
  }

  .tab.done .mark {
    background: var(--sk-accent-a14);
    color: var(--sk-accent);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
