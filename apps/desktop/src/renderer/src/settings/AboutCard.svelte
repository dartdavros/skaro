<script lang="ts">
  import { t } from '@skaro/ui';
  import Card from './Card.svelte';
  import { LINKS, updates } from './updates.svelte';

  /** "О программе": the version, checking for a newer one, links. */
  $effect(() => {
    void updates.load();
  });

  const open = (url: string) => void window.skaro.invoke('shell.openExternal', url);
  const tip = $derived(
    updates.failed
      ? t('settings.update.failed.tip')
      : updates.checked
        ? t('settings.update.latest.tip')
        : t('settings.update.check.tip'),
  );
</script>

<Card label={t('settings.about')} id="about">
  <div class="row">
    <span class="name">Skaro <span class="version">{updates.info?.current ?? ''}</span></span>
    {#if updates.info?.latest}
      <button type="button" class="install" onclick={() => open(updates.info?.url ?? LINKS.github)}
        >{t('settings.update.install', { v: updates.info.latest })}</button
      >
    {:else}
      <button type="button" class="check" data-tip={tip} onclick={() => void updates.check()}
        >{t('settings.update.check')}</button
      >
    {/if}
  </div>
  <div class="links">
    <a href={LINKS.github} onclick={(e) => (e.preventDefault(), open(LINKS.github))}
      >{t('settings.link.github')}</a
    >
    <a href={LINKS.site} onclick={(e) => (e.preventDefault(), open(LINKS.site))}
      >{t('settings.link.site')}</a
    >
    <a href={LINKS.community} onclick={(e) => (e.preventDefault(), open(LINKS.community))}
      >{t('settings.link.community')}</a
    >
  </div>
</Card>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .name {
    flex: 1;
    font-size: var(--sk-fs-6);
    color: var(--sk-text-7);
  }

  .version {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-5);
    color: var(--sk-text-13);
  }

  .check,
  .install {
    flex: none;
    height: 28px;
    border: none;
    border-radius: 7px;
    font-size: var(--sk-fs-4);
    cursor: pointer;
  }

  .check {
    padding: 0 12px;
    background: var(--sk-fill-23);
    color: var(--sk-text-6);
    font-weight: 600;
  }

  .check:hover {
    background: var(--sk-fill-28);
    color: var(--sk-text-2);
  }

  .install {
    padding: 0 13px;
    background: var(--sk-accent);
    color: var(--sk-text-1);
    font-weight: 700;
  }

  .install:hover {
    background: var(--sk-accent-hover);
  }

  .links {
    display: flex;
    gap: 18px;
    font-size: var(--sk-fs-5);
    font-weight: 600;
  }

  a {
    color: var(--sk-accent);
    text-decoration: none;
  }

  a:hover {
    color: var(--sk-link-hover);
    text-decoration: underline;
  }
</style>
