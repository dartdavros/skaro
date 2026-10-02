<script lang="ts">
  import { IconButton, Icon, ProjectTabs, t, WindowControls, type ProjectTab } from '@skaro/ui';
  import UpdateButton from './updates/UpdateButton.svelte';

  /** The top bar is the window title bar: home, project tabs, settings, window buttons. */
  let {
    locked = false,
    tabs,
    active,
    home,
    settings,
    onhome,
    onselect,
    onclose,
    onadd,
    onsettings,
  }: {
    /** No agent yet: home and projects are closed until one is added. */
    locked?: boolean;
    tabs: ProjectTab[];
    active?: string;
    home: boolean;
    settings: boolean;
    onhome: () => void;
    onselect: (id: string) => void;
    onclose: (id: string) => void;
    onadd: () => void;
    onsettings: () => void;
  } = $props();

  const mac = window.skaro.platform === 'darwin';
  let maximized = $state(false);

  $effect(() => {
    void window.skaro.invoke('window.isMaximized').then((m) => (maximized = m));
    return window.skaro.on('window.maximized', (m) => (maximized = m));
  });
</script>

<header class="bar" class:mac>
  <button
    type="button"
    class="home"
    class:current={home}
    class:locked
    disabled={locked}
    data-tip={t('tabs.home')}
    aria-label={t('tabs.home')}
    onclick={onhome}
  >
    <span>skaro</span>
  </button>
  <div class="tabs" class:locked inert={locked}>
    <ProjectTabs {tabs} {active} {onselect} {onclose} {onadd} />
  </div>
  <div class="right">
    <UpdateButton />
    <IconButton tip={t('window.settings')} active={settings} onclick={onsettings}>
      <Icon name="settings" size={16} />
    </IconButton>
    {#if !mac}
      <div class="sep"></div>
      <WindowControls
        {maximized}
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
    border-bottom: 1px solid var(--sk-fill-18);
    -webkit-app-region: drag;
    user-select: none;
  }

  /* Room for the macOS traffic lights. */
  .bar.mac {
    padding-left: 80px;
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
    background: var(--sk-fill-14);
  }
</style>
