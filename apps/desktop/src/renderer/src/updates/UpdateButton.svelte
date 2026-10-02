<script lang="ts">
  import { Download } from '@lucide/svelte';
  import { t } from '@skaro/ui';
  import { updates } from '../settings/updates.svelte';
  import './i18n';
  $effect(() => {
    void updates.load();
  });
</script>

{#if updates.available}
  <button
    type="button"
    aria-label={t('updates.available')}
    data-tip={t('updates.available')}
    onclick={() => (updates.open = true)}
  >
    <Download size={16} />
  </button>
{/if}

<style>
  button {
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--sk-accent);
    color: var(--sk-text-1);
    cursor: pointer;
  }
  button:hover {
    background: var(--sk-accent-hover);
  }
</style>
