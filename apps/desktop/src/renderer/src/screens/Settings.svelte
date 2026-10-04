<script lang="ts">
  import { Banner, Icon, t } from '@skaro/ui';
  import { agents } from '../agents.svelte';
  import AboutCard from '../settings/AboutCard.svelte';
  import AppearanceCard from '../settings/AppearanceCard.svelte';
  import { category, type SettingsCategory } from '../settings/categories';
  import '../settings/i18n';
  import NotifyCard from '../settings/NotifyCard.svelte';
  import ProjectDefaultsBlocks from '../settings/ProjectDefaultsBlocks.svelte';
  import ProjectsCard from '../settings/ProjectsCard.svelte';
  import RunsCard from '../settings/RunsCard.svelte';
  import SettingsNav from '../settings/SettingsNav.svelte';
  import { updates } from '../settings/updates.svelte';
  import AgentsSettings from './AgentsSettings.svelte';

  /**
   * "Настройки" (Settings mockup): categories on the left, only the chosen one on the right.
   * Without a ready agent this is the only screen Skaro opens.
   */
  let { noAgents = false }: { noAgents?: boolean } = $props();

  const SECTION_KEY = 'settings.section';
  let current = $state<SettingsCategory>('agents');
  let scroller: HTMLDivElement | undefined = $state();

  $effect(() => {
    void window.skaro
      .invoke('app.getSetting', SECTION_KEY)
      .then((v) => (current = category(v)))
      .catch(() => undefined);
  });

  function pick(id: SettingsCategory): void {
    current = id;
    scroller?.scrollTo({ top: 0 });
    void window.skaro.invoke('app.setSetting', SECTION_KEY, id);
  }
</script>

<div class="settings">
  <SettingsNav {current} onpick={pick} />
  <div class="scroll" bind:this={scroller}>
    <div class="inner">
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
          <a
            href="#about"
            onclick={(e) => {
              e.preventDefault();
              pick('about');
            }}>{t('settings.update.more')}</a
          >
        </div>
      {/if}
      {#if current === 'agents'}
        <AgentsSettings agents={agents.list} />
      {:else if current === 'work'}
        <RunsCard />
        <ProjectDefaultsBlocks part="work" />
      {:else if current === 'projects'}
        <ProjectsCard />
        <ProjectDefaultsBlocks part="projects" />
      {:else if current === 'notify'}
        <NotifyCard />
      {:else if current === 'appearance'}
        <AppearanceCard />
      {:else}
        <AboutCard />
      {/if}
    </div>
  </div>
</div>

<style>
  .settings {
    flex: 1;
    min-height: 0;
    display: flex;
    background: var(--sk-bg);
  }

  .scroll {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 22px 32px 64px;
  }

  .inner {
    max-width: 700px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 30px;
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
