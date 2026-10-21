<script lang="ts">
  import { Button, t } from '@skaro/ui';
  import { updates } from './updates.svelte';

  $effect(() => {
    void updates.load();
  });

  const tip = $derived(
    updates.failed
      ? t('settings.update.failed.tip')
      : updates.checked
        ? t('settings.update.latest.tip')
        : t('settings.update.check.tip'),
  );
</script>

<div class="version">{updates.info?.current ?? ''}</div>
<div class="update">
  {#if updates.available}
    <Button size="sm" variant="primary" onclick={() => (updates.open = true)}
      >{t('updates.title')}</Button
    >
  {:else}
    <Button
      size="sm"
      data-tip={tip}
      disabled={updates.state?.phase === 'checking'}
      onclick={() => void updates.check()}>{t('settings.update.check')}</Button
    >
  {/if}
</div>

<style>
  .version {
    min-height: 22px;
    color: var(--sk-text-muted);
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-5);
    line-height: 22px;
  }

  .update {
    display: flex;
    justify-content: center;
    min-height: 28px;
    margin-top: 16px;
  }
</style>
