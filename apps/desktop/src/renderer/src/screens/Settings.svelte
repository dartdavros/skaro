<script lang="ts">
  import { Banner, Icon, t } from '@skaro/ui';
  import { agents } from '../agents.svelte';
  import AboutCard from '../settings/AboutCard.svelte';
  import AppearanceCard from '../settings/AppearanceCard.svelte';
  import '../settings/i18n';
  import NotifyCard from '../settings/NotifyCard.svelte';
  import ProjectDefaultsBlocks from '../settings/ProjectDefaultsBlocks.svelte';
  import ProjectsCard from '../settings/ProjectsCard.svelte';
  import RunsCard from '../settings/RunsCard.svelte';
  import { updates } from '../settings/updates.svelte';
  import AgentsSettings from './AgentsSettings.svelte';

  /** "Настройки" (Settings mockup). Without a ready agent this is the only screen Skaro opens. */
  let { noAgents = false }: { noAgents?: boolean } = $props();

  let scroller: HTMLDivElement | undefined = $state();

  function about(e: MouseEvent): void {
    e.preventDefault();
    const target = scroller?.querySelector<HTMLElement>('#about');
    if (target) scroller?.scrollTo({ top: target.offsetTop - 12, behavior: 'smooth' });
  }
</script>

<div class="settings">
  <div class="head">
    <div class="inner">
      <div class="titles">
        <span class="title">{t('settings.title')}</span>
        <span class="subtitle">{t('settings.subtitle')}</span>
      </div>
      <span class="spacer"></span>
      <span class="saved" data-tip={t('settings.saved.tip')}>{t('settings.saved')}</span>
    </div>
  </div>
  <div class="scroll" bind:this={scroller}>
    <div class="inner cards">
      {#if noAgents}
        <Banner
          kind="warning"
          title={t('settings.noAgents.title')}
          text={t('settings.noAgents.text')}
        />
      {/if}
      {#if updates.info?.latest}
        <div class="update">
          <Icon name="download" size={16} stroke={1.9} />
          <span class="update-text"
            ><span class="strong">{t('settings.update.banner', { v: updates.info.latest })}</span>
            {t('settings.update.banner.text')}</span
          >
          <a href="#about" onclick={about}>{t('settings.update.more')}</a>
        </div>
      {/if}
      <AgentsSettings agents={agents.list} />
      <RunsCard />
      <ProjectsCard />
      <ProjectDefaultsBlocks />
      <NotifyCard />
      <AppearanceCard />
      <AboutCard />
    </div>
  </div>
</div>

<style>
  .settings {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--sk-fill-5);
  }

  .head {
    flex: none;
    padding: 14px 18px 10px;
    display: flex;
    justify-content: center;
  }

  .inner {
    width: 100%;
    max-width: 760px;
  }

  .head .inner {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .title {
    font-size: var(--sk-fs-13);
    font-weight: 700;
    color: var(--sk-text-5);
  }

  .subtitle {
    font-size: var(--sk-fs-4);
    color: var(--sk-text-21);
  }

  .spacer {
    flex: 1;
  }

  .saved {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-23);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 18px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .update {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 12px 11px 14px;
    border-radius: 9px;
    background: var(--sk-white-a4);
    color: var(--sk-text-13);
  }

  .update-text {
    flex: 1;
    font-size: var(--sk-fs-6);
  }

  .strong {
    font-weight: 600;
  }

  .update a {
    flex: none;
    font-size: var(--sk-fs-6);
    font-weight: 600;
    color: var(--sk-text-13);
    text-decoration: none;
  }
</style>
