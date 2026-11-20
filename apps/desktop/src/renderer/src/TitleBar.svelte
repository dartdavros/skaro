<script lang="ts">
  import { IconButton, Icon, ProjectTabs, t, WindowControls } from '@skaro/ui';
  import type { TitleBarProps } from './titlebar-props';
  import BetaLabel from './BetaLabel.svelte';
  import UpdateButton from './updates/UpdateButton.svelte';
  import DecisionButton from './decisions/DecisionButton.svelte';
  import BackgroundButton from './background/BackgroundButton.svelte';

  /** The top bar is the window title bar: home, project tabs, settings, window buttons. */
  let p: TitleBarProps = $props();

  const mac = window.skaro.platform === 'darwin';
  let maximized = $state(false);

  $effect(() => {
    void window.skaro.invoke('window.isMaximized').then((m) => (maximized = m));
    return window.skaro.on('window.maximized', (m) => (maximized = m));
  });
</script>

<header class="bar" class:mac class:closing={p.closing}>
  <button
    type="button"
    class="home"
    class:current={p.closing || p.home}
    class:locked={!p.closing && p.locked}
    disabled={p.closing || p.locked}
    data-tip={t('tabs.home')}
    aria-label={t('tabs.home')}
    onclick={() => {
      if (!p.closing) p.onhome();
    }}
  >
    <span>skaro<BetaLabel /></span>
  </button>
  <div class="tabs" class:locked={!p.closing && p.locked} inert={!p.closing && p.locked}>
    {#if !p.closing}<ProjectTabs
        tabs={p.tabs}
        active={p.active}
        onselect={p.onselect}
        onclose={p.onclose}
        onadd={p.onadd}
      />{/if}
  </div>
  <div class="right">
    {#if !p.closing}
      <DecisionButton project={p.project} />
      <BackgroundButton />
      <UpdateButton />
      <IconButton tip={t('window.settings')} active={p.settings} onclick={p.onsettings}>
        <Icon name="settings" size={16} />
      </IconButton>
    {/if}
    {#if !mac}
      {#if !p.closing}<div class="sep"></div>{/if}
      <WindowControls
        {maximized}
        closeDisabled={p.closing}
        onminimize={() => window.skaro.invoke('window.minimize')}
        onmaximize={() => window.skaro.invoke('window.toggleMaximize')}
        onclose={() => window.skaro.invoke('window.close')}
      />
    {/if}
  </div>
</header>

<style>
  .bar {
    height: 42px;
    flex: none;
    display: flex;
    align-items: flex-end;
    gap: 10px;
    padding: 0 10px 0 14px;
    background: var(--sk-topbar);
    border-bottom: 1px solid var(--sk-line);
    -webkit-app-region: drag;
    user-select: none;
  }

  /* Room for the macOS traffic lights. */
  .bar.mac {
    padding-left: 80px;
  }

  .bar.closing {
    align-items: center;
  }
  .bar.closing .home span {
    letter-spacing: -0.5px;
  }

  /* The logo is plain text, not a tab: only its colour reacts to hover and "current". */
  .home {
    flex: none;
    display: flex;
    align-items: center;
    height: 32px;
    padding: 0 12px 0 4px;
    border: none;
    background: transparent;
    cursor: pointer;
    -webkit-app-region: no-drag;
  }

  .home.locked,
  .tabs.locked {
    opacity: 0.4;
    cursor: default;
  }

  .home:disabled {
    cursor: default;
  }

  .home span {
    font-size: var(--sk-fs-13);
    font-weight: 700;
    letter-spacing: 0.03em;
    color: var(--sk-text-8);
    transition: color 0.12s ease;
  }

  .home:not(:disabled):hover span,
  .home.current span {
    color: var(--sk-text-bright);
  }

  .tabs {
    flex: 1;
    min-width: 0;
    height: 42px;
    margin-left: -8px;
    display: flex;
  }

  .tabs :global(.tabs) {
    -webkit-app-region: drag;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 42px;
    -webkit-app-region: no-drag;
  }

  .sep {
    width: 1px;
    height: 16px;
    margin: 0 2px;
    background: var(--sk-line);
  }
</style>
