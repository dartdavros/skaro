<script lang="ts">
  import { Banner, Button, Modal, Progress, t } from '@skaro/ui';
  import { updates } from '../settings/updates.svelte';
  import './i18n';
  const state = $derived(updates.state);
  const loading = $derived(
    state?.phase === 'checking' || state?.phase === 'downloading' || state?.phase === 'applying',
  );
  const applying = $derived(
    state?.phase === 'ready' || state?.phase === 'applying' || state?.retry === 'apply',
  );
  const label = $derived(
    state?.phase === 'error'
      ? t('updates.retry')
      : applying
        ? t('updates.apply')
        : t('updates.update'),
  );
  const names = { skaro: 'Skaro', codex: 'Codex', 'claude-code': 'Claude Code' };
  const open = (url: string) => void window.skaro.invoke('shell.openExternal', url);
</script>

<Modal bind:open={updates.open} title={t('updates.title')} width={440}>
  <div class="components">
    {#each state?.components ?? [] as component (component.id)}
      <div class="row">
        <span class="name">{names[component.id]}</span>
        <span class="versions">{component.current} → {component.latest}</span>
        <a
          href={component.url}
          onclick={(e) => {
            e.preventDefault();
            open(component.url);
          }}>{t('updates.release')}</a
        >
      </div>
    {/each}
  </div>
  {#if state?.phase === 'downloading'}
    <Progress done={state.progress ?? 0} total={100} accessibleLabel={t('updates.download')} />
  {/if}
  {#if state?.error}<Banner kind="error" text={t('updates.failed')} />{/if}
  {#if applying && state?.busy}<Banner kind="warning" text={t('updates.busy')} />{/if}
  {#snippet footer()}
    <Button onclick={() => (updates.open = false)}>{t('updates.later')}</Button>
    <Button
      variant="primary"
      disabled={loading ||
        (applying && !!state?.busy) ||
        (!state?.installable && state?.retry !== 'check')}
      onclick={() => void updates.act()}>{label}</Button
    >
  {/snippet}
</Modal>

<style>
  .components {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: var(--sk-fs-6);
  }
  .name {
    flex: 1;
  }
  .versions {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-5);
    color: var(--sk-text-secondary);
  }
  a {
    font-size: var(--sk-fs-5);
    color: var(--sk-accent);
    text-decoration: none;
  }
  a:hover {
    color: var(--sk-link-hover);
    text-decoration: underline;
  }
</style>
