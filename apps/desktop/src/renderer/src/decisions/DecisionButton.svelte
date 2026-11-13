<script lang="ts">
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import { t } from '@skaro/ui';
  import { decisions } from './decisions.svelte';
  import './i18n';
  let { project }: { project?: { id: string; name: string } } = $props();
  $effect(() => decisions.activate(project));
</script>

{#if project}
  <button
    class:waiting={decisions.count > 0}
    class="decision-button"
    onclick={() => decisions.show()}
    data-decision-button
  >
    {t('decisions.title')} · {#if decisions.loading}<LoadingIndicator
        size={12}
      />{:else}{decisions.count}{/if}
  </button>
{/if}

<style>
  .decision-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 10px;
    border: none;
    border-radius: 7px;
    background: var(--sk-selected);
    color: var(--sk-text);
    font: inherit;
    font-size: var(--sk-fs-5);
    white-space: nowrap;
    cursor: pointer;
  }
  .decision-button.waiting {
    color: var(--sk-link);
  }
  .decision-button:hover {
    background: var(--sk-surface-2-hover);
  }
</style>
