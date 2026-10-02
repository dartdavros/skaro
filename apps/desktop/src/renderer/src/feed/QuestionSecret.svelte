<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { QuestionController } from './question-controller.svelte';
  let { model }: { model: QuestionController } = $props();
</script>

<div class="secret">
  <input
    class="fd-input"
    type={model.reveal ? 'text' : 'password'}
    autocomplete="off"
    bind:value={model.custom[model.q.id]}
    onkeydown={(e) => e.key === 'Enter' && void model.send()}
  />
  <button
    type="button"
    class="eye"
    data-tip={model.reveal ? t('card.question.hide') : t('card.question.show')}
    onclick={() => (model.reveal = !model.reveal)}
  >
    <Icon name={model.reveal ? 'eyeOff' : 'eye'} size={15} stroke={1.9} />
  </button>
</div>

<style>
  .secret {
    position: relative;
    display: flex;
  }

  .secret .fd-input {
    height: 34px;
    padding-right: 40px;
    font-family: var(--sk-mono);
  }

  .eye {
    position: absolute;
    right: 4px;
    top: 4px;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--sk-text-21);
    cursor: pointer;
    padding: 0;
  }

  .eye:hover {
    background: var(--sk-fill-15);
    color: var(--sk-text-6);
  }
</style>
