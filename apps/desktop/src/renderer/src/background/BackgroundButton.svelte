<script lang="ts">
  import { Icon, IconButton, t } from '@skaro/ui';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import { background } from './background.svelte';
  import './i18n';
  $effect(() => {
    void background.load();
  });
</script>

<!-- Shown while Skaro works by itself and while its recent outcomes are worth a look. -->
{#if background.jobs.length}
  <IconButton
    tip={t('background.title')}
    aria-label={t('background.title')}
    active={background.open}
    onclick={() => (background.open = true)}
  >
    {#if background.running.length}
      <LoadingIndicator size={16} />
    {:else}
      <Icon name={background.failed ? 'warning' : 'clock'} size={16} />
    {/if}
  </IconButton>
{/if}
